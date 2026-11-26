'use strict';
// The manager's own window: bin\window\10k-window.exe, a native WebView2 host (tools\AppWindow.cs). It needs no Chrome or Edge.
// The exe is built on first use with the .NET Framework compiler that ships with Windows, and rebuilt when its sources change.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'bin', 'window');
const EXE = path.join(OUT_DIR, '10k-window.exe');
const BUILD_SCRIPT = path.join(ROOT, 'tools', 'build-window.ps1');
const SOURCES = [
  path.join(ROOT, 'tools', 'AppWindow.cs'),
  path.join(ROOT, 'tools', 'LoginWindow.cs'),
  path.join(ROOT, 'tools', 'app-window.manifest'),
  path.join(ROOT, 'tools', 'build-window.ps1'),
  path.join(ROOT, 'assets', 'icon.ico'),
];
const STARTUP_WATCH_MS = 6000;

function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

/** 'ready' = built and current, 'stale' = built but older than its sources, 'missing' = never built, 'unsupported' = not Windows or no sources. */
function hostState() {
  if (process.platform !== 'win32') return 'unsupported';
  if (!SOURCES.every((p) => mtime(p) > 0)) return 'unsupported';
  const built = mtime(EXE);
  if (!built) return 'missing';
  return SOURCES.some((p) => mtime(p) > built) ? 'stale' : 'ready';
}

function hostArgs(url, dataDir) {
  return ['--url', url, '--data', dataDir];
}

/** Ends any window of ours still open: it belongs to an earlier run and may hold an old token. Matches our exe only. */
function killWindows() {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/F', '/IM', '10k-window.exe'], { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}

let building = null;
/** Builds the exe once at a time. Resolves true when the exe exists and is current afterwards. */
function build(log) {
  if (building) return building;
  building = (async () => {
    await killWindows(); // a running exe cannot be replaced
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BUILD_SCRIPT],
        { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
          if (err) { log && log.warn('window build failed: ' + String(stderr || stdout || err.message).trim().split('\n')[0]); resolve(false); }
          else { log && log.info('window host built'); resolve(hostState() === 'ready'); }
        });
    });
  })().finally(() => { building = null; });
  return building;
}

/**
 * Opens the window. Resolves true when it is up (or the user closed it quickly), false when the caller should fall back to a
 * browser window: not built and cannot be built, the WebView2 runtime is missing, or the host crashed at start.
 */
async function open(url, dataDir, log) {
  let state = hostState();
  if (state === 'unsupported') return false;
  if (state !== 'ready') {
    if (!(await build(log))) {
      if (!fs.existsSync(EXE)) return false;
    }
  }
  await killWindows();
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    let child;
    try {
      child = spawn(EXE, hostArgs(url, dataDir), { detached: true, stdio: 'ignore', windowsHide: false });
    } catch (e) { log && log.warn('window host did not start: ' + e.message); return resolve(false); }
    const timer = setTimeout(() => done(true), STARTUP_WATCH_MS);
    child.on('error', (e) => { if (!settled) log && log.warn('window host error: ' + e.message); done(false); });
    child.on('exit', (code) => {
      if (settled) return; // closed or replaced after it was already up
      if (code === 0 || code === null) return done(true);
      log && log.warn('window host exited with code ' + code + ', falling back to the browser window');
      done(false);
    });
    child.unref();
  });
}

/**
 * Opens the sign-in window (10k-window.exe --login): Roblox pages only, its own throwaway profile. It reads the Roblox cookie
 * itself and hands it to the manager over the capture channel, so no Chrome, Edge or extension is needed. It closes by itself
 * when the manager stops waiting. Resolves with the child process, or null when the window cannot be used here. The caller
 * watches 'exit': a code of 2 or 3 shortly after start means the window did not come up (WebView2 runtime missing).
 */
async function openLogin({ url = 'https://www.roblox.com/login', dataDir, qr = false, log } = {}) {
  const state = hostState();
  if (state === 'unsupported') return null;
  if (state !== 'ready') {
    if (!(await build(log)) && !fs.existsSync(EXE)) return null;
  }
  const args = ['--login', '--data', dataDir, '--url', url];
  if (qr) args.push('--qr');
  try {
    const child = spawn(EXE, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => { log && log.warn('login window did not start: ' + e.message); });
    child.unref();
    return child;
  } catch (e) {
    log && log.warn('login window did not start: ' + e.message);
    return null;
  }
}

module.exports = { open, openLogin, build, hostState, hostArgs, killWindows, EXE };
