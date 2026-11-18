'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { DATA, logger, sleep, rmrf, uuid } = require('./util');
const { api } = require('./roblox');

const log = logger('browser');

/** Minimal Chrome DevTools Protocol client over Node's built-in WebSocket. */
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
  const cands = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];
  return cands.find((c) => fs.existsSync(c)) || null;
}

/** Start an isolated browser (throwaway profile) with DevTools enabled. */
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

const FILL_JS = `(function(u,p){
  const a=document.querySelector('#login-username, input[name=username]');
  const b=document.querySelector('#login-password, input[name=password]');
  if(!a||!b) return false;
  const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
  set(a,u); set(b,p);
  const btn=document.querySelector('#login-button');
  if(btn) setTimeout(()=>btn.click(),300);
  return true;})`;

class BrowserManager {
  constructor({ settings, accounts }) {
    this.settings = settings;
    this.accounts = accounts;
    this.active = new Map(); // jobId -> {kind, label, close}
  }

  list() { return [...this.active.entries()].map(([id, v]) => ({ id, kind: v.kind, label: v.label })); }

  /**
   * Opens a real login window. If credentials are given they are typed in for you; you solve any
   * captcha / 2FA yourself. As soon as Roblox issues a session cookie it is captured and the window closes.
   */
  async login({ username = '', password = '', timeoutMin = 10 } = {}) {
    const b = await openBrowser(this.settings, 'https://www.roblox.com/login');
    const id = uuid();
    this.active.set(id, { kind: 'login', label: username || 'new login', close: b.close });
    try {
      if (username && password) this._autofill(b.cdp, username, password).catch((e) => log.debug('autofill: ' + e.message));
      const until = Date.now() + timeoutMin * 60000;
      while (Date.now() < until) {
        if (b.cdp.closed) throw new Error('Login window was closed');
        let cookie = null;
        try { cookie = await getRobloxCookie(b.cdp); } catch (e) { if (b.cdp.closed) throw new Error('Login window was closed'); }
        if (cookie) {
          try { await api.getAuthenticated({ cookie }); } catch { await sleep(1000); continue; } // not fully logged in yet
          return cookie;
        }
        await sleep(1000);
      }
      throw new Error('Login timed out');
    } finally {
      this.active.delete(id);
      await b.close();
    }
  }

  async _autofill(cdp, username, password) {
    const until = Date.now() + 30000;
    while (Date.now() < until && !cdp.closed) {
      try {
        const sid = await pageSession(cdp, /roblox\.com\/login/);
        if (sid) {
          const expr = `${FILL_JS}(${JSON.stringify(username)},${JSON.stringify(password)})`;
          const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
          if (r.result && r.result.value === true) return true;
        }
      } catch {}
      await sleep(1000);
    }
    return false;
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

module.exports = { BrowserManager, findBrowser, openBrowser, CDP };
