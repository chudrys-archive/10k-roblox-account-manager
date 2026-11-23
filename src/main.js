'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { ROOT, DATA, logger, readJson, atomicWrite, rmrf } = require('./util');
const { Alerts } = require('./alerts');
const { LogWatcher } = require('./logwatch');
const { Settings } = require('./settings');
const { WinHelper } = require('./winhelper');
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
const { History } = require('./history');

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

function openUi(url, settings) {
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
    "$s.Description = 'Isa''s Roblox Account Manager'",
    PACKAGED_EXE || fs.existsSync(icon) ? `$s.IconLocation = '${q(PACKAGED_EXE || icon)},0'` : '',
    '$s.Save()',
  ].filter(Boolean).join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(lines, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
  return true;
}

async function main() {
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
  const accounts = new AccountStore(vault);
  const guard = new CaptchaGuard({ settings });
  const history = new History();
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
  logwatch.on('verification', (inst) => accounts.markVerification(accounts.get(inst.accountId), 'Roblox client'));
  // Account timeline (History): what the manager saw and did for each account
  watchdog.on('event', (acc, kind, msg) => history.add(acc.id, kind, msg));
  launcher.on('launched', (inst) => history.add(inst.accountId, 'launch', `Started (${inst.reason}) on ${inst.target?.label || inst.target?.type || 'a game'}`));
  logwatch.on('join', (inst, ls) => history.add(inst.accountId, 'join', `Joined server ${ls.jobId ? ls.jobId.slice(0, 8) : '?'} in place ${ls.placeId}`));
  logwatch.on('disconnect', (inst, ls) => {
    if (!ls.disconnectedAt || ls.reportedAt === ls.disconnectedAt) return; // Roblox writes several lines per disconnect
    ls.reportedAt = ls.disconnectedAt;
    history.add(inst.accountId, 'disconnect', `${ls.reason}${ls.code ? ` (code ${ls.code})` : ''}`);
  });
  // live presence for every account (one batched request)
  setInterval(() => {
    const sec = settings.get('presencePollSec');
    if (!sec || !accounts.loaded || Date.now() - (accounts.presenceAt || 0) < sec * 1000 - 500) return;
    accounts.presenceAt = Date.now();
    accounts.pollPresence().catch((e) => log.debug('presence poll: ' + e.message));
  }, 5000).unref();

  const onUnlocked = () => {
    if (settings.get('autoValidateOnStart') && accounts.list.length) {
      accounts.validateMany().catch((e) => log.warn('auto-validate: ' + e.message));
    }
  };

  const updates = new UpdateChecker();
updates.start();
const ctx = { settings, vault, accounts, launcher, watchdog, browser, antiAfk, alerts, guard, history, onUnlocked, createShortcut, updates, capture, captureExtDir: path.join(captureBase(DATA), 'extension') };
  const server = new Server(ctx);
  const port = await server.listen();
  registerCapture({ dataDir: DATA }).catch((e) => require('./util').logger('capture-host').error(e.message));
  atomicWrite(LOCK, JSON.stringify({ pid: process.pid, port, token: server.token, captureToken: capture.token }));

  if (!vault.locked) { accounts.load(); onUnlocked(); }
  await launcher.init();
  logwatch.start();
  watchdog.start();
  antiAfk.start();

  const url = `http://127.0.0.1:${port}/?t=${server.token}`;
  log.info(`UI ready on http://127.0.0.1:${port}`);
  console.log(`\n  Isa's Roblox Account Manager is running.\n  UI: ${url}\n  (closing this window or Ctrl+C quits the manager; your Roblox clients keep running)\n`);
  if (settings.get('openUiOnStart') && !noUi) openUi(url, settings);

  let stopping = false;
  const shutdown = async (sig, { closeClients = false } = {}) => {
    if (stopping) return; stopping = true;
    log.info(`shutting down (${sig}${closeClients ? ', closing Roblox clients' : ''})`);
    watchdog.stop();
    antiAfk.stop();
    guard.stop();
    logwatch.stop();
    launcher.stop();
    accounts.saveNow();
    await browser.closeAll().catch(() => {});
    server.close();
    // stop background processes too: Roblox clients (if asked), the lock holder, the window helper
    await launcher.stopBackground({ closeClients }).catch((e) => log.warn('stop background: ' + e.message));
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
}

main().catch((e) => {
  log.error('fatal: ' + (e.stack || e.message));
  console.error('\nFATAL: ' + e.message);
  process.exitCode = 1;
});
