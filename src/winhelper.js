'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const EventEmitter = require('events');
const { logger, sleep } = require('./util');

const log = logger('winhelper');

/**
 * Supervises the persistent PowerShell helper. Restarts it if it dies and
 * re-applies multi-instance state so the Roblox singleton stays owned.
 */
class WinHelper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.multiWanted = false;
    this.stopping = false;
    this.restarts = 0;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = this._spawn();
    return this.ready;
  }

  async _spawn() {
    const script = path.join(__dirname, 'winhelper.ps1');
    const proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.proc = proc;
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { log.debug('non-json: ' + line); return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'helper error'));
    });
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf += d; if (errBuf.length > 4000) errBuf = errBuf.slice(-4000); });
    proc.on('exit', (code) => {
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('helper exited')); }
      this.pending.clear();
      if (this.proc === proc) this.proc = null;
      if (this.stopping) return;
      log.error(`helper exited (code ${code}). ${errBuf.trim().slice(-500)}`);
      this.ready = null;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.restarts++, 5));
      setTimeout(() => this.start().catch((e) => log.error('restart failed: ' + e.message)), delay);
    });
    // Wait until it answers (Add-Type compile takes a moment).
    const res = await this._raw('ping', {}, 30000);
    if (res !== 'pong') throw new Error('helper did not respond');
    this.restarts = 0;
    if (this.multiWanted) {
      try { this.multiStatus = await this._raw('multi_on', {}); } catch (e) { log.error('multi_on failed: ' + e.message); }
    }
    log.info('helper ready');
    return true;
  }

  _raw(cmd, args, timeout = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('helper not running'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`helper timeout: ${cmd}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
    });
  }

  async call(cmd, args, timeout) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.start();
        return await this._raw(cmd, args, timeout);
      } catch (e) {
        if (attempt === 2 || /unknown command/.test(e.message)) throw e;
        if (!/helper (exited|not running)/.test(e.message)) throw e;
        await sleep(1000);
      }
    }
  }

  async setMulti(on) {
    this.multiWanted = !!on;
    this.multiStatus = await this.call(on ? 'multi_on' : 'multi_off');
    return this.multiStatus;
  }

  async procs() {
    const r = await this.call('procs');
    return Array.isArray(r) ? r : (r ? [r] : []);
  }

  /** { limitBytes, freeBytes }: commit limit and the headroom left under it. */
  memory() {
    return this.call('memory', {}, 10000);
  }

  /** Ends the helper process. Resolves once it has exited (it is killed after 1.5 s). */
  stop() {
    this.stopping = true;
    const p = this.proc;
    if (!p || p.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill(); } catch {} resolve(); }, 1500);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.stdin.end(); } catch { try { p.kill(); } catch {} }
    });
  }
}

module.exports = { WinHelper };
