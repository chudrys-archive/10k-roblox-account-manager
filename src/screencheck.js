'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('./util');

const log = logger('screencheck');
const SCRIPT = path.join(__dirname, 'screencheck.ps1');
const SAME_BELOW = 1.0;        // mean difference per fingerprint cell (0..255) under which two frames count as the same picture
const DIALOG_HITS_NEEDED = 2;  // the same error text must be seen on two checks in a row before a client is restarted
const MAX_PIDS = 64;
const RUN_TIMEOUT_MS = 45e3;

// Text of Roblox's own error / disconnect dialogs and of the script-auth failure.
const DIALOG_RE = /\b(?:disconnected|you (?:were|have been) kicked|error code|auth error|lost connection|connection (?:attempt )?failed)\b/i;
// A moderation message is never "fixed" by relaunching: report it and leave the client alone.
const MODERATION_RE = /\b(?:banned|terminated|moderat\w*|account (?:suspended|deleted))\b/i;

/** Mean absolute difference between two fingerprints (144 two-digit hex values). Infinity when they cannot be compared. */
function fpDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length < 2 || a.length % 2) return Infinity;
  let sum = 0;
  const n = a.length / 2;
  for (let i = 0; i < n; i++) {
    const x = parseInt(a.substr(i * 2, 2), 16);
    const y = parseInt(b.substr(i * 2, 2), 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return Infinity;
    sum += Math.abs(x - y);
  }
  return sum / n;
}

/** 'moderation' | 'dialog' | null for the text read from a window. */
function readDialog(text) {
  const t = String(text || '');
  if (MODERATION_RE.test(t)) return 'moderation';
  if (DIALOG_RE.test(t)) return 'dialog';
  return null;
}

/** Keeps the picture-has-not-changed timer for one client. Returns how long (ms) the picture has been the same. */
function trackFrame(track, fp, now) {
  if (!track.fp || fpDistance(track.fp, fp) >= SAME_BELOW) { track.fp = fp; track.since = now; }
  return now - track.since;
}

/** Runs the inspector for these pids. Resolves to the parsed array. Nothing it captures is written to disk. */
function runScript(pids) {
  return new Promise((resolve, reject) => {
    const list = pids.filter((p) => Number.isInteger(p) && p > 0).slice(0, MAX_PIDS);
    if (!list.length) return resolve([]);
    const proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Pids', list.join(',')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('screen check timed out')); }, RUN_TIMEOUT_MS);
    proc.stdout.on('data', (d) => { out += d; if (out.length > 4e6) out = out.slice(-4e6); });
    proc.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).pop() || '';
      try { const r = JSON.parse(line); resolve(Array.isArray(r) ? r : [r]); } catch { reject(new Error('screen check gave no result: ' + err.trim().slice(-300))); }
    });
  });
}

/**
 * Looks at each keep-alive client's window now and then, and tells the watchdog when one is stuck on a frozen picture or showing
 * an error dialog. It never stores what it sees: the capture and the OCR run in memory inside screencheck.ps1.
 */
class ScreenCheck {
  constructor({ launcher, accounts, settings, watchdog, run = runScript }) {
    this.launcher = launcher;
    this.accounts = accounts;
    this.settings = settings;
    this.watchdog = watchdog;
    this.run = run;
    this.tracks = new Map(); // pid -> { fp, since, dialogHits }
    this.timer = null;
    this.busy = false;
    this.stopped = false;
  }

  start() {
    const loop = async () => {
      try { await this.runOnce(); } catch (e) { log.debug('check: ' + e.message); }
      if (this.stopped) return;
      const sec = this.settings.get('watchdog').screenCheckSec;
      this.timer = setTimeout(loop, (sec > 0 ? sec : 30) * 1000);
    };
    this.timer = setTimeout(loop, 20e3);
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  async runOnce(now = Date.now()) {
    const w = this.settings.get('watchdog');
    if (!w.screenCheckSec || !w.enabled || this.busy) return [];
    if (this.watchdog.guard && this.watchdog.guard.paused) return [];
    this.busy = true;
    try {
      const targets = [];
      for (const inst of this.launcher.instances.values()) {
        const acc = this.accounts.get(inst.accountId);
        if (!acc || !acc.keepAlive || !acc.keepAlive.enabled) continue;
        if (now - (inst.startedAt || now) < w.graceSec * 1000) continue;
        targets.push({ inst, acc });
      }
      for (const pid of [...this.tracks.keys()]) if (!targets.some((t) => t.inst.pid === pid)) this.tracks.delete(pid);
      if (!targets.length) return [];
      const results = await this.run(targets.map((t) => t.inst.pid));
      const issues = [];
      for (const r of results || []) {
        const t = targets.find((x) => x.inst.pid === r.pid);
        if (!t) continue;
        const track = this.tracks.get(r.pid) || { fp: '', since: now, dialogHits: 0 };
        this.tracks.set(r.pid, track);
        if (!r.ok) { track.dialogHits = 0; continue; } // covered, minimized or unreadable: no judgement either way
        const frozenMs = trackFrame(track, r.fp, now);
        const dialog = readDialog(r.text);
        track.dialogHits = dialog === 'dialog' ? track.dialogHits + 1 : 0;
        let issue = null;
        if (dialog === 'moderation') issue = { kind: 'moderation', detail: String(r.text).slice(0, 120) };
        else if (track.dialogHits >= DIALOG_HITS_NEEDED) issue = { kind: 'dialog', detail: String(r.text).slice(0, 120) };
        else if (w.frozenMin && frozenMs > w.frozenMin * 60e3) issue = { kind: 'frozen', detail: `${Math.round(frozenMs / 60e3)} min` };
        if (!issue) continue;
        this.tracks.delete(r.pid);
        issues.push({ pid: r.pid, ...issue });
        await this.watchdog.screenIssue(t.acc, t.inst, issue.kind, issue.detail);
      }
      return issues;
    } finally { this.busy = false; }
  }
}

module.exports = { ScreenCheck, fpDistance, readDialog, trackFrame, runScript, SAME_BELOW, DIALOG_HITS_NEEDED };
