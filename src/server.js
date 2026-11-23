'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, bus, ring, logger, sleep } = require('./util');
const { api } = require('./roblox');
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
    for (const em of [ctx.accounts, ctx.launcher, ctx.watchdog, ctx.antiAfk, ctx.guard]) em.on('change', push);
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
    const ka = setInterval(() => res.write(': ka\n\n'), 20000);
    req.on('close', () => { clearInterval(ka); this.clients.delete(res); });
  }
  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) { try { c.write(msg); } catch {} }
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
      captchaGuard: guard ? guard.publicView() : { paused: false },
      settings: settings.publicView(),
      browsers: browser.list(),
      roblox: settings.get('testClientPath')
        ? detectRoblox('', settings.get('testClientPath'))
        : this.robloxInfo || (this.robloxInfo = detectRoblox(settings.get('robloxPath'))),
      browserFound: !!findBrowser(settings.get('browserPath')),
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
      const run = async (entry) => {
        try {
          this.toast('info', `Login window opened${entry.username ? ` for ${entry.username}` : ''} - complete any captcha / 2FA there.`);
          const cookie = await c.browser.login(entry);
          const { account } = await c.accounts.addCookie(cookie, { group: body.group || undefined, password: body.savePasswords ? entry.password : undefined });
          this.toast('ok', `Logged in as ${account.username}`);
          return true;
        } catch (e) {
          this.toast('error', `Login${entry.username ? ` (${entry.username})` : ''} failed: ${e.message}`);
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
        for (const e of entries) if (await run(e)) ok++;
        if (entries.length > 1) this.toast('ok', `Bulk login finished: ${ok}/${entries.length}`);
      })();
      return { started: entries.length };
    });

    // Check window: log into one account in a separate window and see whether it is banned. Nothing is added to the
    // list. One check (or other login window) at a time.
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
    this.route('POST', '/ui/alerts/test', async () => { await c.alerts.test(); }, { allowLocked: true });
    this.route('POST', '/ui/shortcut', () => { c.createShortcut(); }, { allowLocked: true });
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
        if (bad.length) this.toast('error', `Launch failed for ${bad.length}: ${bad.map((b) => `${c.accounts.get(b.id)?.username}: ${b.error}`).join('; ')}`);
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
      if (body.all) { c.launcher.stopAccounts(null); return { killed: await c.launcher.killAll(true) }; }
      const list = ids(body);
      if (body.stopKeepAlive !== false) c.launcher.stopAccounts(list); // Stop also cancels waiting launches and blocks automatic relaunch
      if (body.stopKeepAlive !== false) for (const id of list) if (c.accounts.get(id).keepAlive.enabled) c.accounts.update(id, { keepAlive: { enabled: false } });
      const pids = [...list.flatMap((id) => c.launcher.byAccount(id).map((i) => i.pid)), ...(body.pids || [])];
      return { killed: await c.launcher.kill(pids, body.stopKeepAlive === false ? 'restart' : 'manual') };
    });
    this.route('POST', '/ui/launch/cancel', ({ body }) => ({ cancelled: c.launcher.cancelQueued(body.all ? null : ids(body)) }));
    this.route('POST', '/ui/tile', async () => ({ tiled: await c.launcher.tile() }));
    this.route('POST', '/ui/window', async ({ body }) => { await c.launcher.windowCmd(body.pid, body.cmd); });
    this.route('POST', '/ui/multi', async () => { c.launcher.multiStatus = null; await c.launcher.applyMulti(); return c.launcher.multiStatus; });

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
