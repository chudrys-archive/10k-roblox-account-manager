'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const EventEmitter = require('events');
const { ROOT, logger } = require('./util');
const { parseHotkey, hotkeyConflict } = require('./hotkey');

const log = logger('tray');
const MAX_STARTS = 3; // a helper that keeps dying is left off instead of restarted forever

/**
 * Tray icon and global hotkeys, run by src/tray.ps1. Emits 'open', 'closeAll' and 'quit'.
 * The helper exits by itself when this process goes away (its stdin closes), so it is never left behind.
 */
class Tray extends EventEmitter {
  constructor({ script = path.join(__dirname, 'tray.ps1'), icon = path.join(ROOT, 'assets', 'icon.ico'), title = "10k's Account Manager" } = {}) {
    super();
    this.script = script; this.icon = icon; this.title = title;
    this.proc = null;
    this.ready = false;
    this.starts = 0;
    this.stopping = false;
    this.wanted = false;
    this.hotkeys = { open: null, closeAll: null };
    this.hotkeyStatus = {}; // name -> { label, ok }
    this.error = '';
  }

  /** Settings to the running helper: starts, stops or re-registers hotkeys as needed. */
  apply(cfg = {}) {
    const open = parseHotkey(cfg.hotkeyOpen);
    const closeAll = parseHotkey(cfg.hotkeyCloseAll);
    const conflict = hotkeyConflict(open, closeAll);
    if (conflict) throw new Error(conflict);
    this.hotkeys = { open, closeAll };
    this.hotkeyStatus = {};
    for (const [name, h] of Object.entries(this.hotkeys)) if (h) this.hotkeyStatus[name] = { label: h.label, ok: null };
    this.wanted = !!cfg.enabled;
    if (!this.wanted) { this.stop(); return; }
    if (this.proc && this.ready) this._sendHotkeys();
    else if (!this.proc) { this.stopping = false; this.starts = 0; this._spawn(); }
  }

  _sendHotkeys() {
    const spec = (h) => (h ? { mods: h.mods, vk: h.vk } : null);
    this._write({ cmd: 'hotkeys', open: spec(this.hotkeys.open), closeAll: spec(this.hotkeys.closeAll) });
  }

  _write(obj) {
    try { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n'); } catch (e) { log.debug('write failed: ' + e.message); }
  }

  _spawn() {
    if (process.platform !== 'win32') { this.error = 'The tray icon is Windows only'; return; }
    if (this.starts >= MAX_STARTS) { this.error = 'The tray helper stopped several times and was left off'; log.warn(this.error); return; }
    this.starts++;
    this.error = '';
    const proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Icon', this.icon, '-TitleArg', this.title], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.proc = proc;
    this.ready = false;
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { log.debug('non-json: ' + line); return; }
      if (m.event === 'ready') { this.ready = true; this.starts = 0; this._sendHotkeys(); this.emit('ready'); return; }
      if (m.event === 'hotkey') {
        const s = this.hotkeyStatus[m.name];
        if (s) s.ok = !!m.ok;
        if (!m.ok) log.warn(`hotkey ${s ? s.label : m.name} could not be registered (another program may use it)`);
        else log.info(`hotkey ${s ? s.label : m.name} registered`);
        this.emit('change');
        return;
      }
      if (m.event === 'open') this.emit('open', !!m.focused);
      else if (m.event === 'closeAll' || m.event === 'quit') this.emit(m.event);
    });
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-1500); });
    proc.on('error', (e) => { this.error = e.message; log.error('spawn failed: ' + e.message); });
    proc.on('exit', (code) => {
      if (this.proc === proc) { this.proc = null; this.ready = false; }
      this.emit('change');
      if (this.stopping || !this.wanted) return;
      log.warn(`tray helper exited (code ${code}). ${errBuf.trim().slice(-300)}`);
      setTimeout(() => { if (this.wanted && !this.proc && !this.stopping) this._spawn(); }, 2000 * this.starts);
    });
  }

  tip(text) { this._write({ cmd: 'tip', text }); }
  balloon(title, text) { this._write({ cmd: 'balloon', title, text }); }

  /** Ends the helper. Resolves once it has exited (it is killed after 1.5 s). */
  stop() {
    this.stopping = true;
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimeout(() => { try { proc.kill(); } catch {} }, 1500);
      proc.once('exit', () => { clearTimeout(kill); resolve(); });
      this._write({ cmd: 'exit' });
      try { proc.stdin.end(); } catch {}
    });
  }

  publicView() {
    return {
      running: !!(this.proc && this.ready),
      error: this.error,
      hotkeys: Object.fromEntries(Object.entries(this.hotkeyStatus).map(([k, v]) => [k, { label: v.label, ok: v.ok }])),
    };
  }
}

module.exports = { Tray };
