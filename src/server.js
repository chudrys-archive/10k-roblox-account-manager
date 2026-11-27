'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, DATA, bus, ring, logger, sleep } = require('./util');
const { Experiment } = require('./experiments');
const { preflight } = require('./preflight');
const profiles = require('./profiles');
const backup = require('./backup');
const diagnostics = require('./diagnostics');
const APP_VERSION = require('../package.json').version;
const snapshot = require('./snapshot');
const vmmap = require('./vmmap');
const scriptAudit = require('./scriptaudit');
const { metricsKey } = require('./launcher');
const { api } = require('./roblox');
const { PRESETS, byId: byPresetId, diffPreset, matchPreset, expandPreset } = require('./presets');
const { resolveTarget, detectRoblox } = require('./launcher');
const { findBrowser } = require('./browser');

const log = logger('server');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

class Server {
  constructor(ctx) {
    this.ctx = ctx; // {settings, vault, accounts, launcher, watchdog, browser, onUnlocked}
    this.token = crypto.randomBytes(24).toString('hex');
    this.clients = new Set();
    this.routes = [];
    this.stateTimer = null;
    this.defineRoutes();
    const push = () => this.pushState();
    for (const em of [ctx.accounts, ctx.launcher, ctx.watchdog, ctx.antiAfk, ctx.guard, ctx.executor]) if (em) em.on('change', push);
    if (ctx.guard) {
      ctx.guard.on('trip', (g) => this.toast('error', `Captcha guard: automation paused after ${g.account}. Resume in the banner once the check is done.`));
      ctx.guard.on('resume', (why) => this.toast('ok', `Captcha guard: automation resumed${why === 'manual' ? '' : ` (${why})`}`));
    }
    bus.on('log', (e) => this.broadcast('log', e));
    bus.on('toast', (t) => this.broadcast('toast', t));
  }

  toast(type, msg) { bus.emit('toast', { type, msg, t: Date.now() }); }

  // ---------- plumbing ----------
  listen() {
    const want = this.ctx.settings.get('port');
    return new Promise((resolve, reject) => {
      let port = want;
      const tryListen = () => {
        const srv = http.createServer((req, res) => this.handle(req, res));
        srv.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && port < want + 20) { port++; tryListen(); } else reject(e);
        });
        srv.listen(port, '127.0.0.1', () => { this.srv = srv; this.port = port; resolve(port); });
      };
      tryListen();
    });
  }

  hostOk(req) {
    const h = (req.headers.host || '').toLowerCase();
    return h === `127.0.0.1:${this.port}` || h === `localhost:${this.port}`;
  }

  originOk(req) {
    const o = req.headers.origin;
    if (!o) return true;
    return o === `http://127.0.0.1:${this.port}` || o === `http://localhost:${this.port}`;
  }

  authed(req) {
    const c = req.headers.cookie || '';
    const m = c.match(/(?:^|;\s*)iram_t=([a-f0-9]+)/);
    return !!m && m[1].length === this.token.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(this.token));
  }

  send(res, status, obj, headers = {}) {
    const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        const s = Buffer.concat(chunks).toString('utf8');
        if (!s) return resolve({});
        try { resolve(JSON.parse(s)); } catch { reject(new HttpError(400, 'invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  // Local-only channel for the capture extension's native host. Needs the capture token from manager.lock.
  handleCapture(req, res, p) {
    const tok = String(req.headers['x-capture-token'] || '');
    const want = this.ctx.capture.token;
    const ok = tok.length === want.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want));
    if (!ok) return this.send(res, 401, { error: 'bad capture token' });
    if (req.method === 'GET' && p === '/capture/status') {
      this.ctx.capture.touch();
      return this.send(res, 200, this.ctx.capture.status());
    }
    if (req.method === 'POST' && p === '/capture/qr') {
      return this.readBody(req).then(
        (body) => this.send(res, 200, { ok: this.ctx.capture.setQr(body && body.src) }),
        () => this.send(res, 400, { error: 'bad body' }),
      );
    }
    if (req.method === 'POST' && p === '/capture/closed') {
      // the login window was closed by hand: stop waiting for it so the next login isn't blocked
      this.ctx.capture.cancel('window closed');
      return this.send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/capture/offer') {
      return this.readBody(req).then(
        (body) => {
          const accepted = this.ctx.capture.offer(body && body.cookie);
          if (!accepted && body && typeof body.tabs === 'number') this.ctx.capture.noteTabs(body.tabs);
          return this.send(res, 200, { accepted });
        },
        () => this.send(res, 400, { error: 'bad body' }),
      );
    }
    return this.send(res, 404, { error: 'no such capture route' });
  }

  route(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler, opts });
  }

  async handle(req, res) {
    try {
      if (!this.hostOk(req)) return this.send(res, 403, 'bad host');
      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      const p = url.pathname;

      // UI bootstrap: /?t=TOKEN sets the session cookie
      if (p === '/' && url.searchParams.get('t')) {
        if (url.searchParams.get('t') !== this.token) return this.send(res, 403, 'bad token - restart the manager or use start.bat');
        res.writeHead(302, { 'Set-Cookie': `iram_t=${this.token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
        return res.end();
      }
      if (p.startsWith('/capture/')) return this.handleCapture(req, res, p);
      if (req.method === 'GET' && !p.startsWith('/ui/') && !p.startsWith('/api/')) return this.static(req, res, p);

      if (p.startsWith('/api/')) return this.handleApi(req, res, url);

      if (!this.authed(req)) return this.send(res, 401, { error: 'not authorized - open the manager via start.bat' });
      if (!this.originOk(req)) return this.send(res, 403, { error: 'bad origin' });

      if (p === '/ui/events') return this.sse(req, res);

      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = p.match(r.re);
        if (!m) continue;
        const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const body = req.method === 'POST' ? await this.readBody(req) : {};
        if (!r.opts.allowLocked && (this.ctx.vault.locked || !this.ctx.accounts.loaded)) throw new HttpError(423, 'vault is locked');
        const out = await r.handler({ params, body, query: url.searchParams, req });
        return this.send(res, 200, out === undefined ? { ok: true } : out);
      }
      this.send(res, 404, { error: 'not found' });
    } catch (e) {
      const internal = e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError;
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : internal ? 500 : 400;
      if (status >= 500) log.error(`${req.method} ${req.url}: ${e.stack || e.message}`);
      try { this.send(res, status === 401 && !(e instanceof HttpError) ? 502 : status, { error: e.message }); } catch {}
    }
  }

  static(req, res, p) {
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return this.send(res, 403, 'forbidden');
    if (p === '/index.html' && !this.authed(req)) {
      return this.send(res, 401, 'Not authorized. Launch the manager with start.bat (it opens the correct link).');
    }
    fs.readFile(file, (err, data) => {
      if (err) return this.send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https://*.rbxcdn.com data:; style-src 'self' 'unsafe-inline'; connect-src 'self'" });
      res.end(data);
    });
  }

  // ---------- live state over SSE ----------
  sse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(this.state())}\n\n`);
    this.clients.add(res);
    const drop = () => { clearInterval(ka); this.clients.delete(res); };
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { drop(); } }, 20000);
    req.on('close', drop);
    res.on('error', drop);
  }
  /** Setup checks, recomputed at most every 20 s: finding Roblox reads the registry. */
  preflightCached() {
    const now = Date.now();
    if (this._pf && now - this._pf.at < 20000) return this._pf.list;
    const c = this.ctx;
    let roblox = null;
    try { roblox = c.launcher.roblox(); } catch { roblox = null; }
    const build = c.runlog ? c.runlog.buildInfo([...c.launcher.instances.values()].map((i) => i.logState && i.logState.robloxVersion)) : null;
    const list = preflight({ settings: c.settings.get(), facts: { roblox, build, multiInstance: !!c.settings.get('multiInstance'), accounts: c.accounts.list.map((a) => ({ username: a.username, status: a.status, keepAlive: a.keepAlive })) } });
    this._pf = { at: now, list };
    return list;
  }

  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      // a viewer that stopped reading would otherwise make this queue grow without limit
      if (c.writableLength > 4 * 1024 * 1024) { this.clients.delete(c); try { c.destroy(); } catch {} continue; }
      try { c.write(msg); } catch { this.clients.delete(c); }
    }
  }
  pushState() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = null; this.broadcast('state', this.state()); }, 250);
  }
  state() {
    const { vault, accounts, launcher, watchdog, settings, browser, antiAfk, guard } = this.ctx;
    const locked = vault.locked || !accounts.loaded;
    return {
      locked, vaultMode: vault.kdf, now: Date.now(),
      accounts: locked ? [] : accounts.list.map((a) => accounts.publicView(a)),
      launcher: launcher.publicView(),
      watchdog: watchdog.publicView(),
      antiAfk: antiAfk.publicView(),
      preflight: locked ? [] : this.preflightCached(),
      runs: locked || !this.ctx.runlog ? null : { ...this.ctx.runlog.stats24h(), build: this.ctx.runlog.buildInfo([...this.ctx.launcher.instances.values()].map((i) => i.logState && i.logState.robloxVersion)) },
      presets: { list: PRESETS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, changes: diffPreset(settings.get(), p.id) })), current: matchPreset(settings.get()) },
      lastErrors: locked || !this.ctx.history ? {} : Object.fromEntries(accounts.list.map((a) => [a.id, this.ctx.history.lastOf(a.id, ['disconnect', 'verify'])]).filter(([, e]) => e)),
      lastEvents: locked || !this.ctx.history ? {} : Object.fromEntries(accounts.list.map((a) => [a.id, this.ctx.history.last(a.id)]).filter(([, e]) => e)),
      captchaGuard: guard ? guard.publicView() : { paused: false },
      settings: settings.publicView(),
      browsers: browser.list(),
      roblox: settings.get('testClientPath')
        ? detectRoblox('', settings.get('testClientPath'))
        : this.robloxInfo || (this.robloxInfo = detectRoblox(settings.get('robloxPath'))),
      browserFound: !!findBrowser(settings.get('browserPath')),
      update: this.ctx.updates ? this.ctx.updates.publicView() : null,
      tray: this.ctx.tray ? this.ctx.tray.publicView() : null,
      executor: this.ctx.executor ? this.ctx.executor.publicView() : null,
      apiUrl: `http://127.0.0.1:${this.port}/api/`,
    };
  }

  // ---------- UI routes ----------
  defineRoutes() {
    const c = this.ctx;
    const acc = (id) => { const a = c.accounts.get(id); if (!a) throw new HttpError(404, 'account not found'); return a; };
    const ids = (b) => (Array.isArray(b.ids) ? b.ids : []).filter((id) => c.accounts.get(id));

    this.route('GET', '/ui/state', () => this.state(), { allowLocked: true });
    this.route('GET', '/ui/logs', () => ring.slice(-500), { allowLocked: true });
    this.route('GET', '/ui/diagnostics', () => {
      const now = Date.now();
      const text = diagnostics.buildReport({ state: this.state(), logs: ring.slice(-150), now, versions: { app: APP_VERSION, node: process.version, os: `${require('os').type()} ${require('os').release()}` } });
      return { text, filename: 'diagnostics-' + new Date(now).toISOString().replace(/[:.]/g, '-') + '.txt' };
    }, { allowLocked: true });
    this.route('POST', '/ui/test/captcha', () => {
      // The simulator generates its own challenge and uses no account or browser data.
      const tiles = [
        { label: 'triangle', symbol: '▲' }, { label: 'diamond', symbol: '◆' },
        { label: 'circle', symbol: '●' }, { label: 'square', symbol: '■' },
      ];
      const expected = crypto.randomInt(tiles.length);
      const target = tiles[expected].label;
      const selected = tiles.findIndex((tile) => tile.label === target);
      const verify = (submission) => submission === expected;
      return { tiles, target, selected, accepted: verify(selected), incorrectRejected: !verify((expected + 1) % tiles.length) };
    }, { allowLocked: true });

    this.route('POST', '/ui/unlock', async ({ body }) => {
      try { c.vault.unlock(body.password || ''); } catch (e) { await sleep(800); throw new HttpError(403, e.message); }
      c.accounts.load();
      c.onUnlocked && c.onUnlocked();
      this.pushState();
    }, { allowLocked: true });

    this.route('POST', '/ui/security/master-password', async ({ body }) => {
      if (c.vault.kdf === 'scrypt' && !c.vault.verifyPassword(body.current || '')) throw new HttpError(403, 'current password is wrong');
      await c.vault.setMasterPassword(body.password || '');
      this.pushState();
      return { mode: c.vault.kdf };
    });

    // accounts
    this.route('POST', '/ui/accounts/import', async ({ body }) => {
      const r = await c.accounts.importText(body.text || '', { group: body.group || undefined });
      this.toast(r.failed.length ? 'warn' : 'ok', `Imported: ${r.added} new, ${r.updated} updated${r.failed.length ? `, ${r.failed.length} failed` : ''}`);
      return r;
    });

    this.route('POST', '/ui/accounts/login', async ({ body }) => {
      // one login window at a time: a second one would supersede the first, and the bulk loop would then fail that account
      if (c.capture.armed() || c.browser.list().some((b) => b.kind === 'login')) return { started: 0, busy: true };
      let stopBulk = false; // set when the person closes the login window by hand
      const run = async (entry) => {
        try {
          this.toast('info', `${c.browser.plannedVia() === 'app' ? 'A sign-in window' : 'Chrome'} opened${entry.username ? ` for ${entry.username}` : ''}. Log in there and the account is added automatically.`);
          const notConnected = setTimeout(() => {
            if (c.browser.needsExtension() && !c.capture.connected()) this.toast('warn', `Capture extension is not connected. In Chrome open chrome://extensions, turn on Developer mode, click Load unpacked and pick ${c.captureExtDir}`);
          }, 8000);
          let cookie;
          try { cookie = await c.browser.login(entry); } finally { clearTimeout(notConnected); }
          const { account, created } = await c.accounts.addCookie(cookie, { group: body.group || undefined, keepExisting: true });
          // a password is saved only when the account that signed in is the one on this line
          if (body.savePasswords && entry.password && entry.username && account.username.toLowerCase() === entry.username.toLowerCase()) c.accounts.update(account.id, { password: entry.password });
          this.toast('ok', created ? `Added ${account.username}` : `${account.username} is already in your list. Cookie refreshed.`);
          return true;
        } catch (e) {
          this.toast('error', `Login${entry.username ? ` (${entry.username})` : ''} failed: ${e.message}`);
          if (e.windowClosed) stopBulk = true;
          return false;
        }
      };
      const entries = [];
      if (body.lines) {
        for (const l of String(body.lines).split(/\r?\n/)) {
          const t = l.trim(); if (!t) continue;
          const i = t.indexOf(':');
          entries.push(i > 0 ? { username: t.slice(0, i), password: t.slice(i + 1) } : { username: t, password: '' });
        }
      } else entries.push({ username: body.username || '', password: body.password || '' });
      // sequential in background: one window at a time
      (async () => {
        let ok = 0;
        for (let i = 0; i < entries.length; i++) {
          if (await run(entries[i])) ok++;
          if (stopBulk) break;
          // short random pause between accounts: back-to-back logins from one network look like bot traffic to Roblox
          if (i < entries.length - 1) await sleep(6000 + Math.random() * 6000);
        }
        if (entries.length > 1) this.toast('ok', `Bulk login finished: ${ok}/${entries.length}`);
      })();
      return { started: entries.length };
    });

    // Create account: opens the Roblox sign-up page in your own Chrome. You fill the form there. When Roblox logs the
    // new account in, the capture adds it to the list the same way a login does. One window at a time.
    this.route('POST', '/ui/accounts/signup', async ({ body }) => {
      if (c.capture.armed() || c.browser.list().some((b) => b.kind === 'login')) return { started: false, busy: true };
      (async () => {
        try {
          this.toast('info', `${c.browser.plannedVia() === 'app' ? 'A sign-in window' : 'Chrome'} opened the Roblox sign-up page. Create the account there and it is added automatically.`);
          const cookie = await c.browser.login({ label: 'new account', url: 'https://www.roblox.com/signup' });
          const { account, created } = await c.accounts.addCookie(cookie, { group: body.group || undefined, keepExisting: true });
          this.toast('ok', created ? `Created and added ${account.username}` : `${account.username} is already in your list. Cookie refreshed.`);
        } catch (e) {
          this.toast('error', `Create account: ${e.message}`);
        }
      })();
      return { started: true };
    });

    // Check window: log into one account in a separate window and see whether it is banned. Nothing is added to the
    // list. One check (or other login window) at a time.
    // Quick login: opens roblox.com/login in your own Chrome, switches to the QR code, and shows it here. Approve it on a
    // phone that is already signed into the account; the login is captured the same way as a normal login.
    this.route('POST', '/ui/accounts/quick-login', async ({ body }) => {
      if (c.capture.armed() || c.browser.list().some((b) => b.kind === 'login')) return { started: false, busy: true };
      (async () => {
        try {
          this.toast('info', `${c.browser.plannedVia() === 'app' ? 'A sign-in window' : 'Chrome'} opens the Roblox login page with the QR code. Approve it on your phone.`);
          const notConnected = setTimeout(() => {
            if (c.browser.needsExtension() && !c.capture.connected()) this.toast('warn', 'Capture extension is not connected, so the quick login window cannot open. Turn on the extension in chrome://extensions.');
          }, 8000);
          let cookie;
          try { cookie = await c.browser.login({ label: 'quick login', qr: true, open: false }); } finally { clearTimeout(notConnected); }
          const { account, created } = await c.accounts.addCookie(cookie, { group: (body && body.group) || undefined, keepExisting: true });
          this.toast('ok', created ? `Added ${account.username}` : `${account.username} is already in your list. Cookie refreshed.`);
        } catch (e) {
          this.toast('error', `Quick login: ${e.message}`);
        }
      })();
      return { started: true };
    });
    this.route('POST', '/ui/accounts/quick-login/state', () => c.capture.qrState());
    // the Add accounts dialog was cancelled or closed while a login was waiting: stop waiting, the sign-in window closes itself
    this.route('POST', '/ui/accounts/login/cancel', () => ({ cancelled: c.capture.cancel('cancelled') }));

    let checkOpen = false;
    this.route('POST', '/ui/accounts/check-login', () => {
      if (checkOpen || c.browser.list().some((b) => b.kind === 'login')) return { started: false, busy: true };
      checkOpen = true;
      (async () => {
        try {
          this.toast('info', 'Check window opened. Log in there and the result shows here. Nothing is added to your list.');
          const cookie = await c.browser.login({ timeoutMin: 10 });
          const [row] = await c.accounts.checkCookies(cookie);
          if (!row || !row.valid) this.toast('error', `Check failed: ${row?.error || 'no session'}`);
          else {
            const where = row.known ? 'already in your list' : 'not in your list';
            if (row.status === 'banned') this.toast('error', `${row.username} is BANNED (${where})`);
            else if (row.status === 'restricted') this.toast('error', `${row.username} is restricted (${where})`);
            else if (row.status === 'needs verification') this.toast('error', `${row.username} needs verification (${where})`);
            else this.toast('ok', `${row.username} is not banned (${where})`);
          }
        } catch (e) {
          this.toast('error', `Check window: ${e.message}`);
        } finally { checkOpen = false; }
      })();
      return { started: true };
    });
    this.route('POST', '/ui/accounts/:id/update', ({ params, body }) => c.accounts.publicView(c.accounts.update(acc(params.id).id, body)));
    this.route('POST', '/ui/accounts/delete', ({ body }) => {
      const list = ids(body);
      for (const id of list) for (const i of c.launcher.byAccount(id)) c.launcher.kill([i.pid], 'account deleted').catch(() => {});
      return { removed: c.accounts.remove(list) };
    });
    this.route('POST', '/ui/accounts/reorder', ({ body }) => { c.accounts.reorder(ids(body)); });
    this.route('POST', '/ui/accounts/group', ({ body }) => {
      for (const id of ids(body)) c.accounts.get(id).group = String(body.group || 'Default').slice(0, 60);
      c.accounts.save();
    });
    this.route('POST', '/ui/accounts/check-cookies', async ({ body }) => c.accounts.checkCookies(body.text || ''));
    this.route('POST', '/ui/accounts/validate', async ({ body }) => c.accounts.validateMany(ids(body)));
    this.route('POST', '/ui/accounts/:id/refresh-cookie', async ({ params }) => { await c.accounts.refreshCookie(acc(params.id)); });
    this.route('POST', '/ui/accounts/:id/browser', async ({ params, body }) => { await c.browser.openAs(acc(params.id), body.url || undefined); });
    this.route('POST', '/ui/accounts/:id/logout', async ({ params }) => {
      const a = acc(params.id);
      await api.logout(c.accounts.session(a));
      a.status = 'invalid'; a.statusMsg = 'Signed out (cookie revoked)'; c.accounts.save();
    });
    this.route('POST', '/ui/accounts/:id/reveal', async ({ params, body }) => {
      if (c.vault.kdf === 'scrypt' && !c.vault.verifyPassword(body.password || '')) throw new HttpError(403, 'master password required');
      const a = acc(params.id);
      return { cookie: a.cookie, password: a.password };
    });
    this.route('POST', '/ui/accounts/export', async ({ body }) => {
      if (c.vault.kdf === 'scrypt' && !c.vault.verifyPassword(body.password || '')) throw new HttpError(403, 'master password required');
      const list = ids(body).map((id) => c.accounts.get(id));
      const fmt = body.format || 'cookie';
      const text = list.map((a) => fmt === 'full' ? `${a.username}:${a.password || ''}:${a.cookie}` : a.cookie).join('\n');
      log.warn(`exported ${list.length} cookie(s)`);
      return { text };
    });
    this.route('POST', '/ui/accounts/friend-each-other', async ({ body }) => {
      const list = ids(body).map((id) => c.accounts.get(id)).filter((a) => a.status === 'valid');
      let sent = 0, accepted = 0, failed = 0;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        try { await api.sendFriendRequest(c.accounts.session(list[i]), list[j].userId); sent++; } catch { failed++; continue; }
        try { await api.acceptFriendRequest(c.accounts.session(list[j]), list[i].userId); accepted++; } catch {}
        await sleep(1200);
      }
      return { sent, accepted, failed };
    });

    // launching
    this.route('POST', '/ui/resolve', async ({ body }) => resolveTarget(body.input, { jobId: body.jobId, session: c.accounts.anySession() }));
    const report = (label, ps) => Promise.all(ps).then((results) => {
      const bad = results.filter((r) => !r.ok && !r.cancelled);
      if (bad.length) this.toast('error', `${label} failed for ${bad.length}: ${bad.map((b) => `${c.accounts.get(b.id)?.username}: ${b.error}`).join('; ')}`);
      else this.toast('ok', `${label}: ${results.length} client(s) done`);
    });
    const wrap = (id, p) => p.then((r) => ({ id, ok: true, ...r }), (e) => ({ id, ok: false, error: e.message, cancelled: !!e.cancelled }));

    this.route('POST', '/ui/restart', ({ body }) => {
      const list = ids(body);
      if (!list.length) throw new HttpError(400, 'select at least one account');
      report('Restart', list.map((id) => wrap(id, c.launcher.restart(id))));
      return { queued: list.length };
    });
    this.route('POST', '/ui/server-hop', ({ body }) => {
      const list = ids(body);
      if (!list.length) throw new HttpError(400, 'select at least one account');
      report('Server hop', list.map((id) => wrap(id, c.launcher.serverHop(id, { preferSmall: !!body.preferSmall }))));
      return { queued: list.length };
    });
    this.route('POST', '/ui/antiafk/now', async () => ({ nudged: await c.antiAfk.tick(true) }));
    this.route('POST', '/ui/captcha-guard/resume', () => { c.guard.resume('manual'); });
    this.route('GET', '/ui/accounts/:id/history', ({ params }) => c.history.list(acc(params.id).id));
    this.route('GET', '/ui/runs', ({ query }) => ({ runs: c.runlog.list({ accountId: query.get('account') || undefined, limit: Math.min(500, Number(query.get('limit')) || 100) }), summary: c.runlog.summary({ sinceMs: Number(query.get('since')) || 0 }) }));
    this.route('POST', '/ui/alerts/test', async () => { await c.alerts.test(); }, { allowLocked: true });
    this.route('POST', '/ui/shortcut', () => { c.createShortcut(); }, { allowLocked: true });
    const bk = (fn) => { try { return fn(); } catch (e) { throw new HttpError(400, e.message); } };
    this.route('GET', '/ui/backups', () => ({ backups: backup.listBackups(DATA), pending: backup.pendingRestore(DATA) }), { allowLocked: true });
    this.route('POST', '/ui/backups/create', () => bk(() => backup.createBackup(DATA, { reason: 'manual', appVersion: APP_VERSION })), { allowLocked: true });
    this.route('POST', '/ui/backups/restore', ({ body }) => bk(() => backup.stageRestore(DATA, body && body.name)), { allowLocked: true });
    this.route('POST', '/ui/backups/cancel', () => { backup.cancelRestore(DATA); }, { allowLocked: true });
    this.route('POST', '/ui/backups/delete', ({ body }) => bk(() => { backup.deleteBackup(DATA, body && body.name); }), { allowLocked: true });
    this.route('POST', '/ui/quit', ({ body }) => {
      const closeClients = !!(body && body.closeClients);
      setTimeout(() => c.shutdown('quit from UI', { closeClients }), 200);
      return { ok: true };
    }, { allowLocked: true });
    this.route('POST', '/ui/game-info', async ({ body }) => {
      const t = await resolveTarget(body.input, { jobId: body.jobId, session: c.accounts.anySession() });
      let info = null;
      if (t.placeId) { try { info = await api.getGameInfo(c.accounts.anySession(), t.placeId); } catch {} }
      return { target: t, info };
    });
    // A/B experiments: change one setting between arms, same accounts and game each time (see src/experiments.js)
    const EXPERIMENT_VARIABLES = { graphicsApi: ['auto', 'd3d11', 'vulkan', 'opengl'], fastProfile: ['off', 'low', 'lowest'], fpsCap: null, graphicsLevel: null, clientPriority: ['Normal', 'BelowNormal', 'Idle'], executorRun: ['off', 'on'] };
    this.route('GET', '/ui/experiments', () => {
      const dir = path.join(DATA, 'experiments');
      let past = [];
      try { past = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 20).map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') })); } catch { /* none yet */ }
      return { variables: Object.keys(EXPERIMENT_VARIABLES), current: this.experiment ? this.experiment.view() : null, past };
    });
    // Launch profiles: named bundles of run settings (see src/profiles.js)
    const profileState = () => ({ list: profiles.listProfiles(c.settings.get('profiles')), current: profiles.fromSettings(c.settings.get()) });
    this.route('GET', '/ui/profiles', () => profileState());
    this.route('POST', '/ui/profiles/apply', ({ body }) => {
      const p = profiles.listProfiles(c.settings.get('profiles')).find((x) => x.id === String(body.id));
      if (!p) throw new HttpError(404, 'profile not found');
      c.settings.update(p.values);
      this.pushState();
      return profileState();
    });
    this.route('POST', '/ui/profiles/save', ({ body }) => {
      try { c.settings.update({ profiles: profiles.saveProfile(c.settings.get('profiles'), body.name, profiles.fromSettings(c.settings.get())) }); } catch (e) { throw new HttpError(400, e.message); }
      return profileState();
    });
    this.route('POST', '/ui/profiles/export', ({ body }) => {
      const p = profiles.listProfiles(c.settings.get('profiles')).find((x) => x.id === String(body.id));
      if (!p) throw new HttpError(404, 'profile not found');
      return { code: profiles.encodeProfile(p.label, p.values) };
    });
    this.route('POST', '/ui/profiles/import', ({ body }) => {
      let d;
      try { d = profiles.decodeProfile(body.code); } catch (e) { throw new HttpError(400, e.message); }
      const name = String(body.name || '').trim() || d.name || 'Imported profile';
      try { c.settings.update({ profiles: profiles.saveProfile(c.settings.get('profiles'), name, d.values) }); } catch (e) { throw new HttpError(400, e.message); }
      return { ...profileState(), imported: name, rejected: d.rejected };
    });
    this.route('POST', '/ui/profiles/delete', ({ body }) => {
      c.settings.update({ profiles: (c.settings.get('profiles') || []).filter((p) => p && p.name !== String(body.name)) });
      return profileState();
    });
    // Resource snapshot of every running client; the second and later ones also show the change since the previous one
    this.route('POST', '/ui/preset', ({ body }) => {
      const p = byPresetId(body && body.id);
      if (!p) throw new HttpError(400, 'unknown preset');
      const changes = diffPreset(c.settings.get(), p.id);
      c.settings.update(expandPreset(p.settings));
      this.pushState();
      return { ok: true, applied: p.id, changes };
    });
    this.route('POST', '/ui/snapshot', async () => {
      const pids = [...c.launcher.instances.keys()];
      const snap = await snapshot.collect(pids);
      const names = Object.fromEntries([...c.launcher.instances.values()].map((i) => [i.pid, c.accounts.get(i.accountId)?.username || String(i.accountId)]));
      const prev = this.lastSnapshot || null;
      this.lastSnapshot = snap;
      try {
        const dir = path.join(DATA, 'snapshots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, new Date(snap.at).toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify({ ...snap, names }, null, 1));
      } catch { /* the readout still works without the file */ }
      return { snapshot: snap, names, diff: prev ? snapshot.diffSnapshots(prev, snap) : [], previousAt: prev ? prev.at : 0 };
    });
    // Memory map of every running client (what kind of memory is committed, and which protection); later ones show the change per minute
    this.route('POST', '/ui/vmmap', async () => {
      const pids = [...c.launcher.instances.keys()];
      const map = await vmmap.collect(pids);
      const names = Object.fromEntries([...c.launcher.instances.values()].map((i) => [i.pid, c.accounts.get(i.accountId)?.username || String(i.accountId)]));
      const prev = this.lastMap || null;
      this.lastMap = map;
      try {
        const dir = path.join(DATA, 'vmmaps');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, new Date(map.at).toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify({ ...map, names }, null, 1));
      } catch { /* the readout still works without the file */ }
      return { map, names, diff: prev ? vmmap.diffMaps(prev, map) : [], previousAt: prev ? prev.at : 0 };
    });
    // Script check: reads the scripts in a folder and lists patterns that make a long session grow (see src/scriptaudit.js)
    this.route('POST', '/ui/audit', async ({ body }) => {
      const target = String(body.path || c.settings.get('executor').scriptsPath || '').trim();
      let result;
      try { result = scriptAudit.auditPath(target); } catch (e) { throw new HttpError(400, e.message); }
      if (body.path && String(body.path).trim() !== c.settings.get('executor').scriptsPath) { try { c.settings.update({ executor: { scriptsPath: String(body.path).trim() } }); } catch { /* keep the result */ } }
      return result;
    });
    // Executor picker: programs that are open now, .exe files in a folder, and "use this one"
    this.route('POST', '/ui/executor/running', async () => ({ programs: await c.executor.running() }));
    this.route('POST', '/ui/executor/scan', async ({ body }) => {
      try { return { files: await c.executor.scanFolder(body.dir) }; } catch (e) { throw new HttpError(400, e.message); }
    });
    this.route('POST', '/ui/executor/use', async ({ body }) => {
      const { validName } = require('./executor');
      const p = String(body.path || '').trim();
      const name = String(body.name || '').trim();
      let patch;
      if (p) {
        if (!/\.exe$/i.test(p) || !fs.existsSync(p)) throw new HttpError(400, 'That file does not exist');
        patch = { enabled: true, path: p };
      } else if (validName(name)) patch = { enabled: true, path: '', processName: name };
      else throw new HttpError(400, 'Pick a program first');
      try { c.settings.update({ executor: patch }); } catch (e) { throw new HttpError(400, e.message); }
      await c.executor.tick();
      return c.executor.publicView();
    });
    this.route('POST', '/ui/executor/task', async ({ body }) => {
      try { if (body.action === 'remove') await c.executor.removeTasks(); else await c.executor.setupTasks(); } catch (e) { throw new HttpError(400, e.message); }
      return c.executor.publicView();
    });
    this.route('POST', '/ui/experiments/stop', () => { if (this.experiment) this.experiment.stop(); return { ok: true }; });
    this.route('POST', '/ui/experiments/start', async ({ body }) => {
      if (this.experiment && this.experiment.state.status === 'running') throw new HttpError(409, 'an experiment is already running');
      const variable = String(body.variable || '');
      if (!(variable in EXPERIMENT_VARIABLES)) throw new HttpError(400, 'unknown variable');
      const allowed = EXPERIMENT_VARIABLES[variable];
      const values = (Array.isArray(body.values) ? body.values : []).map((v) => (allowed ? String(v) : Number(v)));
      if (values.length < 2) throw new HttpError(400, 'give at least two values to compare');
      if (allowed && values.some((v) => !allowed.includes(v))) throw new HttpError(400, 'value not allowed for ' + variable);
      if (!allowed && values.some((v) => !Number.isFinite(v))) throw new HttpError(400, 'values must be numbers');
      if (variable === 'executorRun') {
        if (!c.executor || !c.settings.get('executor').enabled) throw new HttpError(400, 'Turn on Executor handling in Settings first');
        if (!c.executor.pathOk()) throw new HttpError(400, 'The executor location is not known yet. Open the executor once while the manager runs, or enter its location in Settings');
      }
      const list = ids(body);
      if (!list.length) throw new HttpError(400, 'select at least one account');
      const minutes = Math.min(240, Math.max(12, Number(body.minutes) || 20));
      const target = await resolveTarget(body.input, { jobId: body.jobId, session: c.accounts.anySession(list[0]) });
      const l = c.launcher;
      const api = {
        now: () => Date.now(),
        sleep,
        apply: async (k, v) => {
          if (k === 'executorRun') {
            if (v === 'off') { await c.executor.hold(); return; }
            const e = await c.executor.release();
            if (e) throw new Error(e);
            return;
          }
          c.settings.update({ [k]: v });
        },
        launch: async (idList) => { const r = await l.launchMany(idList, target, { reason: 'experiment' }); const bad = r.filter((x) => !x.ok && !x.cancelled); if (bad.length === r.length) throw new Error('no client launched: ' + bad[0].error); },
        sample: () => [...l.instances.values()].filter((i) => Number.isFinite(i.privMB)).map((i) => ({ key: metricsKey(i), privMB: i.privMB })),
        closeAll: async () => {
          const r = l.closeAllStaggered(true);
          if (r.done) await r.done;
          const until = Date.now() + 5 * 60e3;
          while (l.instances.size && Date.now() < until) await sleep(3000);
        },
      };
      this.experiment = new Experiment({ variable, arms: values.map((v) => ({ label: variable + ' = ' + v, value: v })), accountIds: list, minutes, api, dir: path.join(DATA, 'experiments'), original: variable === 'executorRun' ? ((await c.executor.isRunning()) ? 'on' : 'off') : c.settings.get(variable) });
      this.experiment.run().then(() => this.toast('ok', 'Experiment finished: see the Experiments page')).finally(() => { if (variable === 'executorRun') c.executor.held = false; });
      return this.experiment.view();
    });
    this.route('POST', '/ui/favorites', ({ body }) => {
      c.settings.update({ favorites: Array.isArray(body.list) ? body.list : [] });
      this.pushState();
    });

    this.route('POST', '/ui/launch', async ({ body }) => {
      const list = ids(body);
      if (!list.length) throw new HttpError(400, 'select at least one account');
      if (!body.target && !String(body.input || '').trim()) {
        // "Rejoin": every account goes back to where it last was
        const missing = list.filter((id) => !c.launcher.currentTarget(c.accounts.get(id)));
        if (missing.length) throw new HttpError(400, `No target entered and no previous game for: ${missing.map((id) => c.accounts.get(id).username).join(', ')}`);
        report('Rejoin', list.map((id) => wrap(id, c.launcher.launch(id, c.launcher.currentTarget(c.accounts.get(id)), 'rejoin'))));
        return { queued: list.length, target: { label: 'each account\'s last game' } };
      }
      const target = body.target || await resolveTarget(body.input, { jobId: body.jobId, session: c.accounts.anySession(list[0]) });
      c.launcher.launchMany(list, target, { sameServer: !!body.sameServer }).then((results) => {
        const bad = results.filter((r) => !r.ok && !r.cancelled);
        if (bad.length) {
          for (const b of bad) log.warn(`launch failed for ${c.accounts.get(b.id)?.username}: ${b.error}`);
          this.toast('error', `Launch failed for ${bad.length}: ${bad.map((b) => `${c.accounts.get(b.id)?.username}: ${b.error}`).join('; ')}`);
        }
        else this.toast('ok', `Launched ${results.length} client(s)`);
      });
      return { queued: list.length, target };
    });
    this.route('POST', '/ui/keepalive', async ({ body }) => {
      const list = ids(body);
      if (body.enabled) {
        if (!body.target && !String(body.input || '').trim()) {
          // no target typed: keep each account alive where it currently is / last was
          const missing = list.filter((id) => !c.launcher.currentTarget(c.accounts.get(id)));
          if (missing.length) throw new HttpError(400, `Enter a target - no previous game for: ${missing.map((id) => c.accounts.get(id).username).join(', ')}`);
          for (const id of list) c.accounts.update(id, { keepAlive: { enabled: true, target: c.launcher.currentTarget(c.accounts.get(id)) } });
          return { target: { label: 'current game of each account' } };
        }
        const target = body.target || await resolveTarget(body.input, { jobId: body.jobId, session: c.accounts.anySession(list[0]) });
        for (const id of list) c.accounts.update(id, { keepAlive: { enabled: true, input: body.input || '', jobId: body.jobId || '', target } });
        return { target };
      }
      for (const id of list) c.accounts.update(id, { keepAlive: { enabled: false } });
    });
    this.route('POST', '/ui/kill', async ({ body }) => {
      if (body.all) { c.launcher.stopAccounts(null); const r = c.launcher.closeAllStaggered(true); return { killed: 0, closing: r.queued, already: r.already, staggered: true }; }
      const list = ids(body);
      if (body.stopKeepAlive !== false) c.launcher.stopAccounts(list); // Stop also cancels waiting launches and blocks automatic relaunch
      if (body.stopKeepAlive !== false) for (const id of list) if (c.accounts.get(id).keepAlive.enabled) c.accounts.update(id, { keepAlive: { enabled: false } });
      const pids = [...list.flatMap((id) => c.launcher.byAccount(id).map((i) => i.pid)), ...(body.pids || [])];
      return { killed: await c.launcher.kill(pids, body.stopKeepAlive === false ? 'restart' : 'manual') };
    });
    this.route('POST', '/ui/launch/cancel', ({ body }) => ({ cancelled: c.launcher.cancelQueued(body.all ? null : ids(body)) }));
    this.route('POST', '/ui/tile', async () => ({ tiled: await c.launcher.tile() }));
    this.route('POST', '/ui/trim', () => ({ queued: c.launcher.trimNow() }));
    this.route('POST', '/ui/window', async ({ body }) => { await c.launcher.windowCmd(body.pid, body.cmd); });
    this.route('POST', '/ui/multi', async () => { c.launcher.multiStatus = null; await c.launcher.applyMulti(true); return c.launcher.multiStatus; });
    this.route('POST', '/ui/executor/open', async () => {
      const e = await c.executor.openNow();
      if (e) throw new HttpError(400, e);
      return c.executor.publicView();
    });

    // servers
    this.route('POST', '/ui/servers', async ({ body }) => {
      const placeId = Number(body.placeId);
      if (!placeId) throw new HttpError(400, 'place ID required');
      const s = c.accounts.anySession();
      const r = await api.getServers(s, placeId, { cursor: body.cursor, sortOrder: body.sortOrder === 'Asc' ? 'Asc' : 'Desc', excludeFull: body.excludeFull !== false });
      let info = null;
      if (!body.cursor) { try { info = await api.getGameInfo(s, placeId); } catch {} }
      return { servers: r.data || [], next: r.nextPageCursor, info };
    });
    this.route('POST', '/ui/find-user', async ({ body }) => {
      const s = c.accounts.anySession();
      const u = /^\d+$/.test(String(body.user)) ? await api.getUser(s, Number(body.user)) : await api.usernameToUser(s, String(body.user).replace(/^@/, ''));
      const [p] = await api.getPresence(s, [u.id]);
      return { user: { id: u.id, name: u.name, displayName: u.displayName }, presence: p || null };
    });

    // settings
    this.route('POST', '/ui/settings', ({ body }) => {
      const patch = { ...body };
      if (patch.api && patch.api.password === '') delete patch.api.password; // blank = keep
      if (patch.api && patch.api.clearPassword) { patch.api.password = ''; delete patch.api.clearPassword; }
      c.settings.update(patch);
      this.robloxInfo = null;
      this.pushState();
      return c.settings.publicView();
    });
  }

  // ---------- external scripting API ----------
  async handleApi(req, res, url) {
    const s = this.ctx.settings.get('api');
    if (!s.enabled) return this.send(res, 403, { error: 'API disabled in settings' });
    if (req.headers.origin && !this.originOk(req)) return this.send(res, 403, { error: 'cross-origin requests not allowed' });
    const given = req.headers['x-api-password'] || url.searchParams.get('password') || '';
    if (s.password && (given.length !== s.password.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(s.password)))) {
      await sleep(500);
      return this.send(res, 401, { error: 'bad password' });
    }
    const c = this.ctx;
    if (c.vault.locked) return this.send(res, 423, { error: 'vault locked' });
    const q = url.searchParams;
    const need = () => { const a = c.accounts.findByName(q.get('account')); if (!a) throw new HttpError(404, 'account not found'); return a; };
    const p = url.pathname.replace(/\/+$/, '');
    try {
      switch (p) {
        case '/api/accounts':
          return this.send(res, 200, c.accounts.list.map((a) => ({
            username: a.username, userId: a.userId, alias: a.alias, group: a.group, status: a.status, robux: a.robux,
            running: c.launcher.byAccount(a.id).map((i) => i.pid), keepAlive: a.keepAlive.enabled, fields: a.fields,
          })));
        case '/api/status':
          return this.send(res, 200, { ...c.launcher.publicView(), watchdog: c.watchdog.publicView(), captchaGuard: c.guard.publicView() });
        case '/api/history': {
          const a = need();
          return this.send(res, 200, c.history.list(a.id));
        }
        case '/api/launch': {
          const a = need();
          const input = q.get('placeId') || q.get('link') || q.get('target');
          const target = await resolveTarget(input, { jobId: q.get('jobId'), session: c.accounts.session(a) });
          const r = await c.launcher.launch(a.id, target, 'api');
          return this.send(res, 200, { ok: true, ...r });
        }
        case '/api/kill': {
          const a = need();
          return this.send(res, 200, { killed: await c.launcher.kill(c.launcher.byAccount(a.id).map((i) => i.pid), 'api') });
        }
        case '/api/keepalive': {
          const a = need();
          const on = q.get('enabled') !== 'false';
          if (on) {
            const target = await resolveTarget(q.get('placeId') || q.get('link'), { jobId: q.get('jobId'), session: c.accounts.session(a) });
            c.accounts.update(a.id, { keepAlive: { enabled: true, target, input: q.get('placeId') || q.get('link') } });
          } else c.accounts.update(a.id, { keepAlive: { enabled: false } });
          return this.send(res, 200, { ok: true });
        }
        case '/api/field': {
          const a = need();
          const k = q.get('key');
          if (!k) throw new HttpError(400, 'key required');
          if (q.has('value')) { c.accounts.update(a.id, { fields: { [k]: q.get('value') } }); return this.send(res, 200, { ok: true }); }
          return this.send(res, 200, { value: a.fields[k] ?? null });
        }
        case '/api/cookie': {
          if (!s.allowCookieExport || !s.password) throw new HttpError(403, 'cookie export via API is disabled (needs "allow cookie export" + an API password)');
          const a = need();
          log.warn(`API: cookie of ${a.username} was read`);
          return this.send(res, 200, a.cookie);
        }
        default: return this.send(res, 404, { error: 'unknown endpoint', endpoints: ['/api/accounts', '/api/status', '/api/history?account=', '/api/launch?account=&placeId=&jobId=', '/api/kill?account=', '/api/keepalive?account=&placeId=&enabled=', '/api/field?account=&key=[&value=]', '/api/cookie?account='] });
      }
    } catch (e) {
      return this.send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
    }
  }

  close() { for (const c of this.clients) { try { c.end(); } catch {} } this.srv && this.srv.close(); }
}

module.exports = { Server };
