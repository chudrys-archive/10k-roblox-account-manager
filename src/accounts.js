'use strict';
const EventEmitter = require('events');
const { api, RobloxError } = require('./roblox');
const { logger, uuid, pool, extractCookie } = require('./util');

const log = logger('accounts');

function normalize(a) {
  return {
    id: a.id || uuid(),
    userId: a.userId || 0,
    username: a.username || '',
    displayName: a.displayName || '',
    alias: a.alias || '',
    description: a.description || '',
    group: a.group || 'Default',
    cookie: a.cookie || '',
    password: a.password || '',
    status: a.status || 'unknown',     // valid | verify | invalid | banned | error | unknown
    statusMsg: a.statusMsg || '',
    robux: a.robux ?? null,
    avatarUrl: a.avatarUrl || '',
    addedAt: a.addedAt || Date.now(),
    lastUsedAt: a.lastUsedAt || 0,
    lastValidatedAt: a.lastValidatedAt || 0,
    cookieUpdatedAt: a.cookieUpdatedAt || Date.now(),
    order: a.order ?? 0,
    keepAlive: { enabled: false, input: '', jobId: '', target: null, ...(a.keepAlive || {}) },
    lastTarget: a.lastTarget || null,
    fields: a.fields || {},
  };
}

class AccountStore extends EventEmitter {
  constructor(vault) {
    super();
    this.vault = vault;
    this.list = [];
    this.loaded = false;
    this.sessions = new Map();
    this.presence = new Map(); // userId -> {type, location, placeId, at}
    this.saveTimer = null;
  }

  load() {
    const d = this.vault.data || { accounts: [] };
    this.list = (d.accounts || []).map(normalize);
    this.list.sort((a, b) => a.order - b.order);
    this.loaded = true;
    log.info(`loaded ${this.list.length} account(s)`);
    this.changed();
  }

  changed() { this.emit('change'); }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
    this.changed();
  }
  saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.loaded || this.vault.locked) return;
    try { this.vault.save({ accounts: this.list }); } catch (e) { log.error('save failed: ' + e.message); }
  }

  get(id) { return this.list.find((a) => a.id === id) || null; }
  findByName(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    return this.list.find((a) => a.username.toLowerCase() === n)
      || this.list.find((a) => a.alias && a.alias.toLowerCase() === n)
      || this.list.find((a) => String(a.userId) === n || a.id === name) || null;
  }

  /** Live API session for an account; rotated cookies are written straight back. */
  session(acc) {
    let s = this.sessions.get(acc.id);
    if (!s) {
      s = { cookie: acc.cookie, csrf: null };
      s.onCookie = (c) => {
        const cur = this.get(acc.id);
        if (!cur) return;
        cur.cookie = c; cur.cookieUpdatedAt = Date.now();
        log.info(`cookie rotated by Roblox for ${cur.username}; saved`);
        this.save();
      };
      this.sessions.set(acc.id, s);
    }
    if (s.cookie !== acc.cookie) { s.cookie = acc.cookie; s.csrf = null; }
    return s;
  }

  displayName(acc) { return acc.alias || acc.username || String(acc.userId); }

  publicView(acc) {
    const { cookie, password, ...rest } = acc;
    return { ...rest, hasPassword: !!password, cookieAgeDays: Math.floor((Date.now() - acc.cookieUpdatedAt) / 864e5), presence: this.presence.get(acc.userId) || null };
  }

  /** Add or update from a cookie. Returns { account, created }. */
  async addCookie(rawCookie, extra = {}) {
    const cookie = extractCookie(rawCookie);
    if (!cookie) throw new Error('No valid .ROBLOSECURITY cookie found in input');
    const s = { cookie };
    let me;
    try { me = await api.getAuthenticated(s); } catch (e) {
      if (e.status === 401) throw new Error('Cookie is invalid or expired');
      throw e;
    }
    let acc = this.list.find((a) => a.userId === me.id);
    const created = !acc;
    if (!acc) {
      acc = normalize({ userId: me.id, order: this.list.length ? Math.max(...this.list.map((a) => a.order)) + 1 : 0 });
      this.list.push(acc);
    }
    acc.cookie = s.cookie; // s.cookie may have been rotated during the call
    acc.cookieUpdatedAt = Date.now();
    acc.username = me.name; acc.displayName = me.displayName;
    acc.status = 'valid'; acc.statusMsg = ''; acc.lastValidatedAt = Date.now();
    // keepExisting: a sign-in that matches an account already in the list refreshes its cookie and nothing else
    if (!(!created && extra.keepExisting)) {
      if (extra.group) acc.group = extra.group;
      if (extra.alias) acc.alias = extra.alias;
      if (extra.password) acc.password = extra.password;
      if (extra.description) acc.description = extra.description;
    }
    this.sessions.delete(acc.id);
    this.save();
    log.info(`${created ? 'added' : 'updated'} account ${acc.username} (${acc.userId})`);
    // enrich in background (avatar + robux)
    this.enrich([acc]).catch(() => {});
    api.getRobux(this.session(acc), acc.userId).then((r) => { acc.robux = r; this.save(); }, () => {});
    return { account: acc, created };
  }

  /** Bulk import: one entry per line. Formats: cookie | user:pass:cookie | anything containing a cookie. */
  async importText(text, extra = {}) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const entries = [];
    for (const line of lines) {
      const cookie = extractCookie(line);
      if (!cookie) continue;
      const before = line.slice(0, line.indexOf(cookie)).replace(/:+$/, '');
      const parts = before ? before.split(':') : [];
      entries.push({ cookie, password: parts.length >= 2 ? parts.slice(1).join(':') : '' });
    }
    if (!entries.length) throw new Error('No cookies found in the pasted text');
    const results = await pool(entries, 3, (e) => this.addCookie(e.cookie, { ...extra, password: e.password || extra.password }));
    const ok = results.filter((r) => r.ok);
    return {
      added: ok.filter((r) => r.value.created).length,
      updated: ok.filter((r) => !r.value.created).length,
      failed: results.filter((r) => !r.ok).map((r) => r.error.message),
    };
  }

  update(id, patch) {
    const acc = this.get(id);
    if (!acc) throw new Error('account not found');
    for (const k of ['alias', 'description', 'group', 'password']) if (patch[k] !== undefined) acc[k] = String(patch[k]).slice(0, 2000);
    if (patch.fields && typeof patch.fields === 'object') acc.fields = { ...acc.fields, ...patch.fields };
    if (patch.keepAlive) acc.keepAlive = { ...acc.keepAlive, ...patch.keepAlive };
    if (patch.cookie) {
      const c = extractCookie(patch.cookie);
      if (!c) throw new Error('invalid cookie');
      acc.cookie = c; acc.cookieUpdatedAt = Date.now(); acc.status = 'unknown';
      this.sessions.delete(id);
    }
    this.save();
    return acc;
  }

  remove(ids) {
    const set = new Set(ids);
    const n = this.list.length;
    this.list = this.list.filter((a) => !set.has(a.id));
    for (const id of ids) this.sessions.delete(id);
    this.save();
    return n - this.list.length;
  }

  reorder(ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    this.list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    this.list.forEach((a, i) => { a.order = i; });
    this.save();
  }

  /** Set status; fires 'invalid' once when an account goes from usable to invalid/banned. */
  setStatus(acc, status, msg) {
    const was = acc.status;
    acc.status = status; acc.statusMsg = msg || '';
    if ((status === 'invalid' || status === 'banned') && was !== status) this.emit('invalid', acc);
  }

  /**
   * Roblox asked this account to verify (captcha / security check). The account is locked out of
   * launching and keep-alive until the person completes the check in a browser and validates again;
   * listeners close its clients. Returns false if it was already flagged.
   */
  markVerification(acc, where) {
    if (!acc || acc.status === 'verify') return false;
    acc.keepAlive.pausedForVerify = !!acc.keepAlive.enabled || !!acc.keepAlive.pausedForVerify;
    acc.keepAlive.enabled = false;
    this.setStatus(acc, 'verify', `Roblox asked for verification (${where}). Open the account in the browser, complete the check, then click Validate.`);
    log.warn(`${acc.username}: needs verification (${where}) - clients closed, keep-alive paused`);
    this.save();
    this.emit('verification', acc, where);
    return true;
  }

  /** Verification is done: back to normal, and keep-alive resumes if verification paused it. */
  clearVerification(acc) {
    if (acc.keepAlive.pausedForVerify) acc.keepAlive.enabled = true;
    delete acc.keepAlive.pausedForVerify;
    this.setStatus(acc, 'valid');
    log.info(`${acc.username}: verification cleared`);
  }

  /** Check cookie validity, username changes, bans and robux. */
  async validate(acc) {
    const s = this.session(acc);
    try {
      const me = await api.getAuthenticated(s);
      if (me.id !== acc.userId && acc.userId) throw new Error(`cookie belongs to a different user (${me.name})`);
      acc.userId = me.id; acc.username = me.name; acc.displayName = me.displayName;
      const mod = await api.getModeration(s);
      if (mod) this.setStatus(acc, 'banned', `Moderated: ${mod.punishmentTypeDescription || mod.messageToUser || 'restricted'}`);
      else if (acc.status === 'verify') {
        // only a successful sign-in ticket proves Roblox no longer wants the check
        await api.getAuthTicket(s);
        this.clearVerification(acc);
      } else this.setStatus(acc, 'valid');
      try { acc.robux = await api.getRobux(s, acc.userId); } catch {}
    } catch (e) {
      if (e && e.verification) this.markVerification(acc, 'validate');
      else if (/moderated/i.test(String(e.message))) this.setStatus(acc, 'banned', 'Roblox says this account is moderated, so it cannot join games');
      else if (e instanceof RobloxError && e.status === 401) this.setStatus(acc, 'invalid', 'Cookie expired or revoked - re-login needed');
      else this.setStatus(acc, 'error', e.message);
    }
    acc.lastValidatedAt = Date.now();
    this.save();
    return acc.status;
  }

  async validateMany(ids) {
    const accs = (ids && ids.length ? ids.map((id) => this.get(id)) : this.list).filter(Boolean);
    await pool(accs, 3, (a) => this.validate(a));
    await this.enrich(accs).catch(() => {});
    const counts = {};
    for (const a of accs) counts[a.status] = (counts[a.status] || 0) + 1;
    log.info(`validated ${accs.length}: ${JSON.stringify(counts)}`);
    return counts;
  }

  async enrich(accs) {
    const valid = accs.filter((a) => a.userId);
    if (!valid.length) return;
    const any = this.list.find((a) => a.status === 'valid');
    const shots = await api.headshots(any ? this.session(any) : {}, valid.map((a) => a.userId));
    for (const a of valid) if (shots[a.userId]) a.avatarUrl = shots[a.userId];
    this.save();
  }

  async refreshCookie(acc) {
    const s = this.session(acc);
    const fresh = await api.refreshCookie(s);
    const check = await api.getAuthenticated({ cookie: fresh });
    if (check.id !== acc.userId) throw new Error('refreshed cookie belongs to another user?!');
    acc.cookie = fresh; acc.cookieUpdatedAt = Date.now();
    if (!['banned', 'verify'].includes(acc.status)) acc.status = 'valid'; // a new cookie doesn't lift a ban or a check
    this.sessions.delete(acc.id);
    this.save();
    log.info(`refreshed cookie for ${acc.username}`);
  }

  /**
   * Cookie checker: validate raw cookies without storing anything. Reports per cookie:
   * valid, userId, username, displayName, created, robux, status (active / restricted / banned /
   * needs verification / invalid) and whether it is already in the manager.
   */
  async checkCookies(text) {
    const raw = String(text || '').split(/\r?\n/).map((l) => extractCookie(l)).filter(Boolean);
    const cookies = [...new Set(raw)].slice(0, 500);
    const out = new Array(cookies.length);
    await pool(cookies.map((c, i) => [c, i]), 3, async ([cookie, i]) => {
      const s = { cookie };
      const row = { n: i + 1, valid: false, status: 'invalid', tail: cookie.slice(-6) };
      try {
        const me = await api.getAuthenticated(s);
        Object.assign(row, { valid: true, userId: me.id, username: me.name, displayName: me.displayName, status: 'active' });
        row.known = !!this.list.find((a) => a.userId === me.id);
        try { row.created = (await api.getUser(s, me.id)).created || ''; } catch {}
        try { row.robux = await api.getRobux(s, me.id); } catch {}
        const mod = await api.getModeration(s);
        if (mod) row.status = /ban|delet|terminat/i.test(JSON.stringify(mod)) ? 'banned' : 'restricted';
      } catch (e) {
        if (e && e.verification) { row.valid = true; row.status = 'needs verification'; }
        else row.error = e.status === 401 ? 'invalid or expired' : e.message;
      }
      out[i] = row;
    });
    log.info(`cookie check: ${out.filter((r) => r.valid).length}/${out.length} valid`);
    return out;
  }

  /** Live presence of every account (one batched request per 100 accounts). Kept in memory only. */
  async pollPresence() {
    const ids = this.list.filter((a) => a.userId && !['invalid', 'banned'].includes(a.status)).map((a) => a.userId);
    if (!ids.length) return;
    const s = this.anySession();
    if (!s.cookie) return;
    for (let i = 0; i < ids.length; i += 100) {
      const ps = await api.getPresence(s, ids.slice(i, i + 100));
      for (const p of ps) this.presence.set(p.userId, { type: p.userPresenceType, location: p.lastLocation || '', placeId: p.placeId || 0, at: Date.now() });
    }
    this.changed();
  }

  /** Any valid session (used for public-ish endpoints that still want auth, e.g. server lists). */
  anySession(preferId) {
    const p = preferId && this.get(preferId);
    if (p && !['invalid', 'verify'].includes(p.status)) return this.session(p);
    const a = this.list.find((x) => x.status === 'valid') || this.list.find((x) => !['invalid', 'verify'].includes(x.status));
    return a ? this.session(a) : {};
  }
}

module.exports = { AccountStore };
