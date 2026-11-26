'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { ROOT, DATA, logger, readJson, atomicWrite, rmrf } = require('./util');
const { Alerts } = require('./alerts');
const { LogWatcher } = require('./logwatch');
const { Settings } = require('./settings');
const { WinHelper } = require('./winhelper');
const { Tray } = require('./tray');
const { Executor } = require('./executor');
const appWindow = require('./appwindow');
const { Vault } = require('./vault');
const { AccountStore } = require('./accounts');
const { Launcher } = require('./launcher');
const { Watchdog } = require('./watchdog');
const { BrowserManager, findBrowser } = require('./browser');
const { Server } = require('./server');
const { AntiAfk } = require('./antiafk');
const { CaptchaGuard } = require('./captchaguard');
const { UpdateChecker } = require('./updatecheck');
const { CaptureGate } = require('./capture');
const { registerCapture, captureBase } = require('./nativehost');
const { History, recordDisconnect } = require('./history');
const { RunLog, buildRecord } = require('./runlog');
const backup = require('./backup');
const APP_VERSION = require('../package.json').version;

const log = logger('main');
const LOCK = path.join(DATA, 'manager.lock');
const noUi = process.argv.includes('--no-ui');

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

/**
 * Kill the Edge app window left over from an earlier run (matched by its own profile, never the user's Edge) so the
 * next openUi call always opens a fresh window at the correct URL and token.
 * Edge app-mode reuses windows by origin (scheme+host+port); if the manager
 * restarts on the same port with a new token, Edge would otherwise focus the
 * stale window and show "not found".
 */
function killStaleEdgeAppWindows(profile) {
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--user-data-dir=${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } catch { /* ignore — no stale windows, or PowerShell unavailable */ }
}

// The manager's own window (native WebView2, no browser needed). A browser app window is the fallback when it cannot start,
// or when Settings > General > Manager window is set to Browser window.
function openUi(url, settings) {
  if (settings.get('windowMode') === 'browser') return openBrowserWindow(url, settings);
  appWindow.open(url, DATA, log)
    .then((ok) => { if (!ok) openBrowserWindow(url, settings); })
    .catch((e) => { log.warn('window: ' + e.message); openBrowserWindow(url, settings); });
}

function openBrowserWindow(url, settings) {
  const edge = findBrowser(settings.get('browserPath'));
  if (edge) {
    // The manager's window lives in its own Edge profile: a stale one is killed by profile, and the user's own
    // Edge windows are never touched.
    const profile = path.join(DATA, 'edge-app');
    killStaleEdgeAppWindows(profile);
    spawn(edge, [`--user-data-dir=${profile}`, `--app=${url}`, '--window-size=1400,900', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
    // Edge app windows keep the light caption; paint it black once the window exists (Windows only, best effort).
    const tb = path.join(ROOT, 'src', 'titlebar.ps1');
    if (fs.existsSync(tb)) spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tb], { stdio: 'ignore', windowsHide: true }).unref();
  } else {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  }
}

const PACKAGED_EXE = process.env.IRAM_LAUNCHER_EXE;
const HIDDEN_LAUNCHER = path.join(ROOT, 'Start Manager.vbs');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** Start with Windows via the per-user Run key (no admin needed). Starts hidden, without opening the window. */
function applyAutostart(on) {
  const command = PACKAGED_EXE ? `"${PACKAGED_EXE}" --no-ui` : `wscript.exe "${HIDDEN_LAUNCHER}" --no-ui`;
  try {
    if (on) execFileSync('reg', ['add', RUN_KEY, '/v', 'IsaRobloxAccountManager', '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true, stdio: 'ignore' });
    else execFileSync('reg', ['delete', RUN_KEY, '/v', 'IsaRobloxAccountManager', '/f'], { windowsHide: true, stdio: 'ignore' });
  } catch { /* delete of a missing value fails harmlessly */ }
}

/** Desktop shortcut that starts the manager without a console window (or opens it if running). */
function createShortcut() {
  const q = (s) => s.replace(/'/g, "''");
  // our own icon: a borrowed Roblox icon would break when Roblox deletes old version folders on update
  const icon = path.join(ROOT, 'assets', 'icon.ico');
  const lines = [
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Roblox Account Manager.lnk'))",
    `$s.TargetPath = '${q(PACKAGED_EXE || 'wscript.exe')}'`,
    `$s.Arguments = '${PACKAGED_EXE ? '' : `"${q(HIDDEN_LAUNCHER)}"`}'`,
    `$s.WorkingDirectory = '${q(PACKAGED_EXE ? path.dirname(PACKAGED_EXE) : ROOT)}'`,
    "$s.Description = '10k''s Account Manager'",
    PACKAGED_EXE || fs.existsSync(icon) ? `$s.IconLocation = '${q(PACKAGED_EXE || icon)},0'` : '',
    '$s.Save()',
  ].filter(Boolean).join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(lines, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
  return true;
}

async function main() {
  const restored = backup.applyPendingRestore(DATA, { appVersion: APP_VERSION, log: (m) => logger('backup').info(m) });
  if (restored.applied) console.log(`  Restored backup ${restored.name}. Your data from before is saved as ${restored.before || 'a backup'}.`);
  const settings = new Settings();

  // single instance: if already running, just open its UI
  const lock = readJson(LOCK, null);
  if (lock && lock.pid !== process.pid && alive(lock.pid)) {
    try {
      const r = await fetch(`http://127.0.0.1:${lock.port}/ui/state`, { signal: AbortSignal.timeout(3000) });
      if (r.status === 401 || r.ok) {
        console.log('Manager already running - opening its window.');
        if (!noUi) openUi(`http://127.0.0.1:${lock.port}/?t=${lock.token}`, settings);
        return;
      }
    } catch {}
  }

  // clean leftover temp browser profiles
  try { for (const d of fs.readdirSync(path.join(DATA, 'tmp'))) await rmrf(path.join(DATA, 'tmp', d), 1); } catch {}

  const helper = new WinHelper();
  await helper.start();
  const vault = new Vault(helper);
  await vault.init();
  const autoBackup = () => {
    try {
      if (!backup.needsAutoBackup(DATA)) return;
      logger('backup').info('automatic backup ' + backup.createBackup(DATA, { reason: 'auto', appVersion: APP_VERSION }).name);
    } catch (e) { logger('backup').warn('automatic backup skipped: ' + e.message); }
  };
  autoBackup();
  setInterval(autoBackup, 6 * 3600 * 1000).unref();
  const accounts = new AccountStore(vault);
  const guard = new CaptchaGuard({ settings });
  const history = new History();
  const runlog = new RunLog({ file: path.join(DATA, 'runs.jsonl') });
  const launcher = new Launcher({ helper, settings, accounts, guard });
  const alerts = new Alerts({ settings });
  const logwatch = new LogWatcher({ launcher });
  const watchdog = new Watchdog({ launcher, accounts, settings, logwatch, alerts, guard });
  const capture = new CaptureGate();
  const browser = new BrowserManager({ settings, accounts, capture });
  const antiAfk = new AntiAfk({ helper, launcher, settings, accounts });
  accounts.on('invalid', (acc) => alerts.send('invalid', `${acc.username}: login needed`, `${acc.statusMsg || 'The saved session is no longer valid.'}\nRe-login from the account's Details.`, { level: 'error', key: acc.id }));
  settings.on('change', (s) => applyAutostart(s.startWithWindows));
  // Verification lockdown: close every client of the account and label it until the person verifies.
  // Captcha guard: the same event also pauses all automatic activity (see captchaguard.js).
  accounts.on('verification', (acc, where) => {
    history.add(acc.id, 'verify', `Roblox asked for verification (${where})`);
    const pids = launcher.byAccount(acc.id).map((i) => i.pid);
    if (pids.length) launcher.kill(pids, 'needs verification').catch((e) => log.warn('close on verification: ' + e.message));
    alerts.send('invalid', `${acc.username}: needs verification`, `Roblox asked this account to verify (${where}). Its client was closed and keep-alive paused. Open the account in the browser from the manager, complete the check, then click Validate.`, { level: 'error', key: acc.id, force: true });
    if (guard.trip(acc, where)) {
      alerts.send('captchaGuard', 'Automation paused', `${acc.username} hit a captcha / verification. Keep-alive rejoins, restarts, server hops and API launches are stopped for every account until you press Resume in the manager.`, { level: 'error', key: 'guard' });
    }
  });
  logwatch.on('verification', (inst) => {
    const acc = accounts.get(inst.accountId);
    if (!accounts.markVerification(acc, 'Roblox client')) return;
    // The client also logs this when Roblox has locked or moderated the account: re-check it so the label says which.
    setTimeout(() => accounts.validate(acc).then(() => accounts.save()).catch(() => {}), 5000);
  });
  logwatch.on('joinchallenge', (inst) => {
    const acc = accounts.get(inst.accountId);
    if (!acc) return;
    history.add(acc.id, 'challenge', 'Roblox showed a challenge in the client window while joining; solve it there, the client continues by itself');
    log.info(`${acc.username}: Roblox challenge shown in the client window (join-game); client left running`);
  });
  // Account timeline (History): what the manager saw and did for each account
  watchdog.on('event', (acc, kind, msg) => history.add(acc.id, kind, msg));
  launcher.on('exit', (inst) => {
    const rec = runlog.add(buildRecord({ ...inst, log: inst.logState }, accounts.get(inst.accountId)?.username));
    history.add(inst.accountId, 'run-end', `${rec.kind}: ${rec.reason}; ran ${Math.round(rec.uptimeMs / 60e3)} min, peak ${rec.peakPrivMB} MB`);
  });
  launcher.on('launched', (inst) => history.add(inst.accountId, 'launch', `Started (${inst.reason}) on ${inst.target?.label || inst.target?.type || 'a game'}`));
  logwatch.on('join', (inst, ls) => history.add(inst.accountId, 'join', `Joined server ${ls.jobId ? ls.jobId.slice(0, 8) : '?'} in place ${ls.placeId}`));
  logwatch.on('disconnect', (inst, ls) => recordDisconnect(history, inst.accountId, ls));
  // live presence for every account (one batched request)
  setInterval(() => {
    const sec = settings.get('presencePollSec');
    if (!sec || !accounts.loaded || Date.now() - (accounts.presenceAt || 0) < sec * 1000 - 500) return;
    accounts.presenceAt = Date.now();
    accounts.pollPresence().catch((e) => log.debug('presence poll: ' + e.message));
  }, 5000).unref();

  const cookieChecker = require('./cookiecheck').createCookieChecker({ accounts, settings, log });
  setInterval(() => cookieChecker.tick(), 10 * 60e3).unref();

  const onUnlocked = () => {
    if (settings.get('autoValidateOnStart') && accounts.list.length) {
      accounts.validateMany().catch((e) => log.warn('auto-validate: ' + e.message));
    }
  };

  const updates = new UpdateChecker();
updates.start();
const tray = new Tray();
const executor = new Executor({ settings, launcher, accounts, alerts });
launcher.beforeLaunch = () => executor.ensureOpen();
const ctx = { tray, executor, settings, vault, accounts, launcher, watchdog, browser, antiAfk, alerts, guard, history, runlog, onUnlocked, createShortcut, updates, capture, captureExtDir: path.join(captureBase(DATA), 'extension') };
  const server = new Server(ctx);
  const port = await server.listen();
  registerCapture({ dataDir: DATA }).catch((e) => require('./util').logger('capture-host').error(e.message));
  atomicWrite(LOCK, JSON.stringify({ pid: process.pid, port, token: server.token, captureToken: capture.token }));

  if (!vault.locked) { accounts.load(); onUnlocked(); }
  await launcher.init();
  logwatch.start();
  watchdog.start();
  executor.start();
  antiAfk.start();

  const url = `http://127.0.0.1:${port}/?t=${server.token}`;
  log.info(`UI ready on http://127.0.0.1:${port}`);
  console.log(`\n  10k's Account Manager is running.\n  UI: ${url}\n  (closing this window or Ctrl+C quits the manager; your Roblox clients keep running)\n`);
  if (settings.get('openUiOnStart') && !noUi) openUi(url, settings);

  // Tray icon and hotkeys. Close all is the same staggered close as the Close all button.
  tray.on('open', (focused) => { if (!focused) openUi(url, settings); }); // an open window is only brought to the front
  tray.on('closeAll', () => {
    try {
      launcher.stopAccounts(null);
      const r = launcher.closeAllStaggered(true);
      log.info(`tray: closing all clients one by one (${r.queued} queued)`);
      tray.balloon("10k's Account Manager", r.queued ? `Closing ${r.queued} client(s) one at a time` : 'No clients to close');
    } catch (e) { log.warn('tray close all: ' + e.message); }
  });
  tray.on('quit', () => shutdown('tray'));
  tray.on('change', () => server.pushState());
  const applyTray = (s) => { try { tray.apply(s.tray); } catch (e) { log.warn('tray: ' + e.message); } server.pushState(); };
  settings.on('change', applyTray);
  applyTray(settings.get());

  let stopping = false;
  const shutdown = async (sig, { closeClients = false } = {}) => {
    if (stopping) return; stopping = true;
    log.info(`shutting down (${sig}${closeClients ? ', closing Roblox clients' : ''})`);
    watchdog.stop({ clearResume: closeClients });
    antiAfk.stop();
    guard.stop();
    logwatch.stop();
    launcher.stop();
    accounts.saveNow();
    await browser.closeAll().catch(() => {});
    server.close();
    // stop background processes too: Roblox clients (if asked), the lock holder, the window helper
    await launcher.stopBackground({ closeClients }).catch((e) => log.warn('stop background: ' + e.message));
    executor.stopWatching();
    await tray.stop().catch(() => {});
    await helper.stop();
    try { if (readJson(LOCK, {}).pid === process.pid) fs.rmSync(LOCK, { force: true }); } catch {}
    setTimeout(() => process.exit(0), 300);
  };
  ctx.shutdown = shutdown;
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP')); // console window closed
  process.on('uncaughtException', (e) => log.error('uncaught: ' + (e.stack || e.message)));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection: ' + (e && (e.stack || e.message))));
  // "Stops responding" means the event loop was blocked. Log every stall so manager.log shows when and how long.
  let lagAt = Date.now();
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - lagAt - 1000;
    lagAt = now;
    if (lag > 2000) log.warn(`event loop blocked for ${Math.round(lag / 1000)}s`);
  }, 1000);
  if (lagTimer.unref) lagTimer.unref();
  // Run window: close clients (staggered) when the window ends, if the person asked for that
  let wasActive = require('./schedule').isActive(settings.get('schedule'));
  const schedTimer = setInterval(() => {
    try {
      const sc = settings.get('schedule');
      const now = require('./schedule').isActive(sc);
      if (wasActive && !now && sc && sc.enabled && sc.closeAtEnd) {
        log.info('schedule: run window ended, closing clients one by one');
        launcher.stopAccounts(null);
        launcher.closeAllStaggered(true);
      }
      wasActive = now;
    } catch (e) { log.debug('schedule check: ' + e.message); }
  }, 30e3);
  if (schedTimer.unref) schedTimer.unref();
  // Memory alert: when the fleet health turns red, say so once per cooldown (the webhook URL is never logged)
  let lastLevel = 'ok';
  const levelTimer = setInterval(() => {
    try {
      const f = launcher.publicView().fleet;
      if (f && f.level === 'danger' && lastLevel !== 'danger') {
        alerts.send('memory', 'Free memory is low', `Free commit ${f.freeGB == null ? 'unknown' : f.freeGB.toFixed(1)} GB, ${f.clients} client(s), growth ${f.gbPerHour == null ? 'unknown' : f.gbPerHour.toFixed(1)} GB/h. Close clients manually, staggered, from the Clients page.`, { level: 'error', key: 'fleet' });
      }
      lastLevel = f ? f.level : 'ok';
    } catch (e) { log.debug('level check: ' + e.message); }
  }, 60e3);
  if (levelTimer.unref) levelTimer.unref();
  // Private commit per client every 5 minutes. Shows whether each client keeps growing or levels off.
  const commitTimer = setInterval(async () => {
    try {
      const procs = await launcher.helper.procs();
      if (!procs.length) return;
      const parts = procs.map((p) => {
        const inst = [...launcher.instances.values()].find((i) => i.pid === p.pid);
        const acc = inst && accounts.get(inst.accountId);
        return `${acc ? acc.username : 'pid ' + p.pid} ${p.privMB} MB`;
      });
      log.info(`private commit per client: ${parts.join(', ')}`);
    } catch (e) { log.debug('commit sample: ' + e.message); }
  }, 5 * 60e3);
  if (commitTimer.unref) commitTimer.unref();
}

main().catch((e) => {
  log.error('fatal: ' + (e.stack || e.message));
  console.error('\nFATAL: ' + e.message);
  process.exitCode = 1;
});
