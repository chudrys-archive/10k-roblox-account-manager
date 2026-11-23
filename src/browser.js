'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { DATA, logger, sleep, rmrf, uuid } = require('./util');
const { api } = require('./roblox');
const log = logger('browser');

/** Minimal Chrome DevTools Protocol client over Node's built-in WebSocket. Used only for the check and session windows. */
class CDP extends EventEmitter {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP connect timeout')); }, 15000);
      ws.onopen = () => { clearTimeout(t); resolve(new CDP(ws)); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('CDP connect failed')); };
    });
  }
  constructor(ws) {
    super();
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.closed = false;
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else if (m.method) this.emit(m.method, m.params, m.sessionId);
    };
    ws.onclose = () => {
      this.closed = true;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('browser closed')); }
      this.pending.clear();
      this.emit('close');
    };
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('browser closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

function findBrowser(override) {
  if (override && fs.existsSync(override)) return override;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = process.env.LOCALAPPDATA || '';
  // Chrome first: the manager window and the check / login windows run on it. Edge and Brave are fallbacks.
  const cands = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];
  return cands.find((c) => fs.existsSync(c)) || null;
}

/** Your browser's user-data folder, for the browser we open logins in. */
function userDataDir(exe) {
  const la = process.env.LOCALAPPDATA || '';
  if (/msedge\.exe$/i.test(exe)) return path.join(la, 'Microsoft', 'Edge', 'User Data');
  if (/brave\.exe$/i.test(exe)) return path.join(la, 'BraveSoftware', 'Brave-Browser', 'User Data');
  return path.join(la, 'Google', 'Chrome', 'User Data');
}

/** The profile you used last in that browser, else Default. */
function loginProfile(exe) {
  const root = userDataDir(exe);
  try {
    const last = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')).profile?.last_used;
    if (last && fs.existsSync(path.join(root, last))) return last;
  } catch { /* no Local State yet */ }
  return 'Default';
}

/** Opens roblox.com/login in a new window of your own profile. No DevTools, no autofill, no automation flags. */
function openLoginWindow(settings, url = 'https://www.roblox.com/login') {
  const exe = findBrowser(settings.get('browserPath'));
  if (!exe) throw new Error('No Chrome or Edge found. Set a browser path in Settings.');
  const profile = loginProfile(exe);
  const child = spawn(exe, [`--profile-directory=${profile}`, '--new-window', url], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => log.error('login window: ' + e.message));
  child.unref();
  return profile;
}

/** Start an isolated browser (throwaway profile) with DevTools enabled. Used for session windows only. */
async function openBrowser(settings, startUrl = 'about:blank') {
  const exe = findBrowser(settings.get('browserPath'));
  if (!exe) throw new Error('No Chromium browser found (Edge/Chrome). Set a browser path in Settings.');
  const dir = path.join(DATA, 'tmp', 'browser-' + uuid());
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(exe, [
    `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-features=msImplicitSignin,EdgeSidebar',
    '--new-window', startUrl,
  ], { stdio: 'ignore', windowsHide: false });
  const portFile = path.join(dir, 'DevToolsActivePort');
  const until = Date.now() + 25000;
  let content = null;
  while (Date.now() < until) {
    try { content = fs.readFileSync(portFile, 'utf8'); if (content.includes('\n')) break; } catch {}
    if (proc.exitCode !== null) break;
    await sleep(250);
  }
  if (!content) { try { proc.kill(); } catch {} await rmrf(dir); throw new Error('Browser did not expose DevTools (is another policy blocking it?)'); }
  const [port, wsPath] = content.split(/\r?\n/);
  const cdp = await CDP.connect(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`);
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    try { await cdp.send('Browser.close'); } catch {}
    cdp.close();
    await sleep(800);
    try { proc.kill(); } catch {}
    await rmrf(dir);
  };
  cdp.on('close', () => { setTimeout(() => { if (!closed) { closed = true; rmrf(dir); } }, 1500); });
  return { cdp, proc, dir, close };
}

async function pageSession(cdp, urlMatch) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page' && (!urlMatch || urlMatch.test(x.url))) || targetInfos.find((x) => x.type === 'page');
  if (!t) return null;
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  return sessionId;
}

async function getRobloxCookie(cdp) {
  const { cookies } = await cdp.send('Storage.getCookies');
  const c = cookies.find((x) => x.name === '.ROBLOSECURITY' && /roblox\.com$/.test(x.domain) && x.value);
  return c ? c.value : null;
}

class BrowserManager {
  constructor({ settings, accounts, capture }) {
    this.settings = settings;
    this.accounts = accounts;
    this.capture = capture;
    this.active = new Map(); // jobId -> {kind, label, close}
  }

  list() { return [...this.active.entries()].map(([id, v]) => ({ id, kind: v.kind, label: v.label })); }

  /**
   * Opens roblox.com/login in your own Chrome profile (a new window) and waits for the capture extension to hand
   * over the Roblox cookie. Resolves with the cookie. Nothing is stored here: the caller decides what to do with it.
   */
  async login({ username = '', timeoutMin = 10, url = 'https://www.roblox.com/login', label: given = '', qr = false, open = true } = {}) {
    const label = given || username || 'new login';
    const id = uuid();
    const wait = this.capture.arm({ timeoutMs: timeoutMin * 60000, label, qr });
    wait.catch(() => {});
    this.active.set(id, { kind: 'login', label, close: () => this.capture.cancel('cancelled') });
    try {
      if (open) openLoginWindow(this.settings, url);
      return await wait;
    } catch (e) {
      this.capture.cancel('cancelled');
      throw e;
    } finally {
      this.active.delete(id);
    }
  }

  /** Open roblox.com logged in as the account in an isolated window. Cookie rotations are synced back. */
  async openAs(acc, url = 'https://www.roblox.com/home') {
    const b = await openBrowser(this.settings, 'about:blank');
    const id = uuid();
    this.active.set(id, { kind: 'session', label: acc.username, close: b.close });
    try {
      await b.cdp.send('Storage.setCookies', {
        cookies: [{ name: '.ROBLOSECURITY', value: acc.cookie, domain: '.roblox.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 365 * 86400 }],
      });
      const sid = await pageSession(b.cdp);
      if (sid) await b.cdp.send('Page.navigate', { url }, sid);
    } catch (e) {
      this.active.delete(id); await b.close(); throw e;
    }
    // watch for rotation until closed
    (async () => {
      while (!b.cdp.closed) {
        await sleep(5000);
        try {
          const c = await getRobloxCookie(b.cdp);
          const cur = this.accounts.get(acc.id);
          if (c && cur && c !== cur.cookie) {
            const me = await api.getAuthenticated({ cookie: c });
            if (me.id === cur.userId) { cur.cookie = c; cur.cookieUpdatedAt = Date.now(); this.accounts.sessions.delete(cur.id); this.accounts.save(); log.info(`synced rotated browser cookie for ${cur.username}`); }
          }
        } catch {}
      }
      this.active.delete(id);
    })();
    return id;
  }

  async closeAll() { for (const [, v] of this.active) await v.close().catch(() => {}); this.active.clear(); }
}

module.exports = { BrowserManager, findBrowser, openBrowser, openLoginWindow, loginProfile, CDP };