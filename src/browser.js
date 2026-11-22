'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { DATA, logger, sleep, rmrf, uuid } = require('./util');
const { api } = require('./roblox');
const { solveFunCaptcha, CaptchaError, ROBLOX_PK } = require('./captcha');

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
   * Opens a real login window. If credentials are given they are typed in for you.
   * If captcha.backend is configured in settings, FunCaptcha is solved automatically.
   * Falls back to manual solve if the solver fails or is not configured.
   * As soon as Roblox issues a session cookie it is captured and the window closes.
   */
  async login({ username = '', password = '', timeoutMin = 10 } = {}) {
    const b = await openBrowser(this.settings, 'https://www.roblox.com/login');
    const id = uuid();
    this.active.set(id, { kind: 'login', label: username || 'new login', close: b.close });
    try {
      // Start captcha auto-solver in background (non-blocking — falls back to manual on failure)
      const captchaConfig = this.settings.get('captcha');
      if (captchaConfig && captchaConfig.backend && captchaConfig.backend !== 'none' && captchaConfig.apiKey) {
        this._monitorAndSolveCaptcha(b.cdp, captchaConfig).catch((e) => {
          log.warn('auto-captcha: ' + e.message + ' — solve manually in the browser window');
        });
      }

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

  /**
   * Wait for the FunCaptcha challenge to appear in the network traffic, solve it via
   * the configured service, then inject the token back into the page.
   *
   * Detection: sniff Network.responseReceived for requests to arkoselabs.com/fc/gc/
   * which is the challenge initialisation endpoint. The public key is in the ?id= param
   * and the blob is embedded in the response token field.
   *
   * Injection: Runtime.evaluate with four fallback methods, in priority order.
   * Which one works depends on the current Roblox page version — verify with devtools.
   */
  async _monitorAndSolveCaptcha(cdp, captchaConfig) {
    // Wait up to 20s for the login page session to attach
    let sessionId = null;
    const sessionDeadline = Date.now() + 20000;
    while (Date.now() < sessionDeadline && !cdp.closed) {
      try { sessionId = await pageSession(cdp, /roblox\.com\/login/); } catch {}
      if (sessionId) break;
      await sleep(600);
    }
    if (!sessionId || cdp.closed) {
      log.debug('captcha monitor: no login page session found');
      return;
    }

    // Enable CDP Network domain on this page session
    await cdp.send('Network.enable', {}, sessionId);
    log.debug('captcha monitor: network enabled, watching for FunCaptcha challenge...');

    return new Promise((resolve) => {
      const seenRequests = new Map(); // requestId -> url

      const onRequest = (params, sid) => {
        if (sid !== sessionId) return;
        const url = params.request && params.request.url;
        if (!url) return;
        if (url.includes('arkoselabs.com') || url.includes('funcaptcha.com')) {
          seenRequests.set(params.requestId, url);
        }
      };

      const onResponse = async (params, sid) => {
        if (sid !== sessionId) return;
        if (!seenRequests.has(params.requestId)) return;
        const url = seenRequests.get(params.requestId);

        // Only act on the challenge-init endpoint
        if (!url.includes('/fc/gc/')) return;

        // Grab the public key from the URL query string
        let publicKey = ROBLOX_PK.login; // fallback
        try {
          const urlObj = new URL(url);
          const qk = urlObj.searchParams.get('id');
          if (qk) publicKey = qk;
        } catch {}

        // Grab the response body to extract the blob
        let blob = null;
        try {
          const { body } = await cdp.send('Network.getResponseBody', { requestId: params.requestId }, sessionId);
          const data = JSON.parse(body);
          const tokenField = data.token || '';
          // The blob is embedded as "blob~<value>|" inside the token string
          if (tokenField.includes('blob~')) {
            blob = tokenField.split('blob~')[1].split('|')[0];
          }
        } catch (e) {
          log.debug('captcha monitor: could not read response body: ' + e.message);
        }

        log.info(`FunCaptcha challenge detected — pk=${publicKey.slice(0, 8)}… blob=${blob ? 'yes' : 'no'}`);

        // Detach listeners before solving to avoid duplicate attempts
        cdp.off('Network.requestWillBeSent', onRequest);
        cdp.off('Network.responseReceived', onResponse);
        cdp.off('close', onClose);

        try {
          const token = await solveFunCaptcha(captchaConfig, publicKey, { blob });
          await this._injectCaptchaToken(cdp, sessionId, token);
          resolve(token);
        } catch (e) {
          log.warn('captcha solve failed: ' + e.message);
          resolve(null);
        }
      };

      const onClose = () => resolve(null);

      cdp.on('Network.requestWillBeSent', onRequest);
      cdp.on('Network.responseReceived', onResponse);
      cdp.on('close', onClose);
    });
  }

  /**
   * Inject the solved FunCaptcha token into the Roblox login page.
   * Tries four methods in order; logs which one fired.
   * If none work on the current build, open DevTools, check window.__rbxChallengeVerification
   * or the fc-token hidden input and update accordingly.
   */
  async _injectCaptchaToken(cdp, sessionId, token) {
    const js = `(function(token) {
      // Method 1: Roblox challenge verification handler (most reliable on recent builds)
      if (typeof window.__rbxChallengeVerification === 'function') {
        window.__rbxChallengeVerification(token);
        return 'rbxChallengeVerification';
      }
      // Method 2: Any fc_callback_* or _fc_* global registered by the enforcement script
      const cbKey = Object.keys(window).find(k =>
        (k.startsWith('fc_callback') || k.startsWith('_fc_')) && typeof window[k] === 'function'
      );
      if (cbKey) { window[cbKey](token); return 'fc_callback:' + cbKey; }
      // Method 3: Hidden input #FunCaptcha-Token or input[name="fc-token"]
      const inp = document.querySelector('#FunCaptcha-Token, input[name="fc-token"], input[id*="captcha"][type="hidden"]');
      if (inp) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(inp, token);
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        const form = inp.closest('form');
        if (form) { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
        return 'hidden-input';
      }
      // Method 4: postMessage into every iframe (FunCaptcha may be sandboxed)
      let count = 0;
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ id: 'funcaptcha', token }, '*'); count++; } catch {}
      });
      return 'postMessage:' + count + '-iframes';
    })(${JSON.stringify(token)})`;

    try {
      const r = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true }, sessionId);
      const method = r && r.result && r.result.value;
      log.info('captcha token injected via: ' + (method || 'unknown'));
    } catch (e) {
      log.warn('captcha token inject error: ' + e.message);
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

module.exports = { BrowserManager, findBrowser, openBrowser, CDP };
