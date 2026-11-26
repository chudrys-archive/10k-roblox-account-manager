'use strict';
const path = require('path');
const EventEmitter = require('events');
const { DATA, atomicWrite, readJsonSafe, deepMerge, logger } = require('./util');
const { validName } = require('./executor');

const FILE = path.join(DATA, 'settings.json');
// Bump when the safe defaults change. Installs saved at an older version get the safe defaults once.
const SETTINGS_VERSION = 2;

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  port: 7963,
  openUiOnStart: true,
  loginWindow: 'app',          // where Add account opens Roblox sign-in: 'app' = a sign-in window of its own (no Chrome, Edge or extension), 'browser' = Chrome/Edge with the capture extension
  windowMode: 'app',           // 'app' = built-in window, 'browser' = Chrome/Edge app window
  autoValidateOnStart: true,
  validateEveryHours: 0,       // 0 = off; else re-check every account's login this often and alert on dead cookies
  presencePollSec: 30,         // live presence for all accounts; 0 = off

  // launching
  multiInstance: true,         // on by default: several clients side by side by holding Roblox's single-instance lock (launcher.js). Turn off if clients close unexpectedly
  launchDelaySec: 6,           // gap between consecutive launches (Roblox rate-limits rapid joins)
  signInGapSec: 120,          // multi-instance: the next client starts signing in only when the previous one started at least this long ago (30-600)
  launchTimeoutSec: 90,        // how long to wait for the Roblox process to appear
  onAlreadyRunning: 'skip',    // 'replace' | 'skip' | 'allow'. 'replace' closes the running client (and any executor in it), so it stays opt-in
  robloxPath: '',              // blank = auto-detect (registry handler / Versions folder)
  testClientPath: '',          // exact RobloxPlayerBeta.exe for compatibility testing
  neverUpdateRoblox: false,    // "Don't update Roblox": start the installed client directly and disable Roblox's updater (off = safe)
  skipUpdateCheck: true,       // launch RobloxPlayerBeta.exe directly when the installed version is current
  renameWindows: true,
  windowTitle: '{name}',       // {name} {username} {alias} {userId} {group}
  autoTile: false,
  tileColumns: 0,              // 0 = auto
  minimizedAction: 'leave',    // 'leave' | 'park': park = a client that gets minimized is moved off-screen instead (see Experiments)
  dryRun: false,               // true = launches only log what they would do (nothing is started or written)
  noPowerThrottle: false,      // true = ask Windows not to put clients in efficiency mode (EcoQoS) when they are in the background
  graphicsApi: 'auto',         // 'auto' | 'd3d11' | 'vulkan' | 'opengl': see src/fflags.js
  // Low-resource defaults: most people run these clients to idle (AFK farming), so every client starts small, slow and plain.
  fastProfile: 'lowest',       // 'off' | 'low' | 'lowest': see src/fflags.js (texture quality, post-processing)
  fpsCap: 15,                  // 0 = don't touch the frame cap
  graphicsLevel: 1,            // 1-10 pins Roblox's graphics quality for every client; 0 = leave it alone (Automatic)
  windowWidth: 320,            // with windowHeight: client window size in pixels, far below Roblox's own 800x600 minimum (the manager shrinks it); 0 = leave alone
  windowHeight: 240,
  customFFlags: '',            // raw JSON merged into ClientAppSettings.json (empty = safe)

  // keep-alive watchdog
  watchdog: {
    enabled: true,
    startOnEnable: false,      // false: keep-alive only relaunches a client that was open and then closed; true: it also starts accounts that are not running
    resumeAfterRestart: true,  // after a PC restart or a manager crash, keep-alive accounts that were running are launched again, one at a time (never ones you closed yourself)
    tickSec: 5,
    presenceCheck: true,
    presenceIntervalSec: 45,
    graceSec: 150,             // don't judge presence right after launch
    badChecksToRestart: 2,
    disconnectGraceSec: 25,    // log says disconnected and no rejoin within this -> restart
    relaunchDelaySec: 15,       // first rejoin; repeated rejoins back off (x2 each, max 10 min)
    killHungAfterSec: 0,        // 0 = never force-kill a frozen client (a kill also closes any executor in it)
    maxRelaunchesPerHour: 15,
    fallbackToPublic: true,    // if a specific JobId keeps failing, join any server instead
    restartEveryMin: 0,        // 0 = never; otherwise scheduled restart of keep-alive clients
    breakerDisconnects: 4,     // this many kicks/disconnects inside breakerWindowMin turn keep-alive off for that account (0 = off)
    breakerWindowMin: 60,
  },

  // captcha guard: a captcha / verification on any account pauses all automatic activity
  captchaGuard: {
    enabled: true,
    pauseAll: true,            // false = only the affected account is stopped (the pre-5.1 behaviour)
    autoResumeMin: 0,          // 0 = wait for Resume; otherwise resume by itself after this many minutes
  },

  // anti-AFK: Roblox kicks after 20 idle minutes
  antiAfk: {
    enabled: false,            // off = safe: it focuses Roblox windows and sends input
    intervalMin: 12,           // nudge each client this often (max 16 so the +3 min grace stays under 20)
    action: 'space',           // 'space' (jump) | 'wasd' (step fwd+back) | 'rightclick' (camera) | 'key'
    key: '',                   // used when action = 'key' (A-Z, 0-9, F1-F24)
    waitUserIdleSec: 4,        // wait until you've paused input this long (max delay: 3 min)
    includeUntracked: false,   // also nudge Roblox windows not started by the manager
  },

  // per-client resource tuning
  clientPriority: 'Normal',    // Normal | BelowNormal | Idle
  trimMemoryMin: 0,            // empty clients' working sets every N min (0 = off)
  trimWhenFreeBelowPct: 50,    // ...but only while free physical RAM is under this percent of the total (100 = always); trimming costs CPU
  cpuCapPct: 0,                // 0 = off; else each background client may use at most this % of the whole PC's CPU (Windows job object)
  closeAllKeepsMain: true,     // Close all (button, hotkey, run-window end) and scheduled restarts leave your Main account's client alone
  cpuCapSpareFront: true,      // the client you are looking at (in front) and clients still loading are never capped

  schedule: { enabled: false, start: '08:00', end: '23:00', days: '1234567', closeAtEnd: false }, // run window for automatic launches: see src/schedule.js
  profiles: [],                // saved launch profiles [{name, values}]: see src/profiles.js
  favorites: [],               // [{name, input, jobId, icon}]

  // audio: 'none' | 'all' (mute every client) | 'background' (only the focused client plays sound)
  muteMode: 'none',

  alerts: {
    webhook: '',               // Discord webhook URL
    mention: '',               // e.g. <@123> - pinged on errors only
    cooldownMin: 5,            // same alert for the same account at most once per N minutes
    events: { crash: true, disconnect: true, sameAccount: true, invalid: true, throttled: true, launchFail: false, captchaGuard: true, memory: true, executor: true },
    quiet: { enabled: false, start: '23:00', end: '07:00' }, // local time; errors are still sent
  },

  startWithWindows: false,

  // Tray icon (open, close all, quit) and optional global hotkeys such as 'Ctrl+Alt+M'. Blank hotkey = none.
  tray: { enabled: true, hotkeyOpen: '', hotkeyCloseAll: '' },

  browserPath: '',             // blank = Edge, then Chrome

  // Executor handling (any executor; Potassium is the name looked for until you pick another). On by default and harmless when no executor is
  // running: it only acts once it has seen the executor open. openBeforeClients opens the executor before a client starts, because some executors
  // (Potassium) close every running Roblox client when they open.
  executor: { enabled: true, processName: 'Potassium.exe', path: '', relaunch: true, startWithManager: false, asAdmin: false, openBeforeClients: true, openWaitSec: 15, taskPath: '', scriptsPath: '', afterLaunch: { command: '', args: '', delaySec: 20, rerunOnRestart: true } },

  api: {
    enabled: false,
    password: '',
    allowCookieExport: false,
  },

};

class Settings extends EventEmitter {
  constructor() {
    super();
    const r = readJsonSafe(FILE, {});
    const saved = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
    if (r.corrupt) { this.recovered = r.corrupt; logger('settings').error(`settings.json could not be read (${r.error}); it was moved to ${r.corrupt} and defaults are in use`); }
    this.data = deepMerge(DEFAULTS, saved);
    // A first run has no saved file at all and simply starts on DEFAULTS; only an older saved file is migrated.
    if (Object.keys(saved).length && (saved.settingsVersion || 0) < SETTINGS_VERSION) {
      // one-time: installs saved before the safe defaults move onto them. Accounts, alerts and the
      // other preferences are kept; only settings that can close clients or upset the display change.
      const d = this.data;
      Object.assign(d, { neverUpdateRoblox: false, fastProfile: 'off', fpsCap: 0, customFFlags: '', clientPriority: 'Normal', trimMemoryMin: 0, onAlreadyRunning: 'skip' });
      d.antiAfk = { ...d.antiAfk, enabled: false };
      d.watchdog = { ...d.watchdog, killHungAfterSec: 0, restartEveryMin: 0 };
      d.settingsVersion = SETTINGS_VERSION;
      try { this.save(); } catch { /* read-only data dir: the safe values still apply for this run */ }
    }
  }
  get(k) { return k ? this.data[k] : this.data; }
  update(patch) {
    const next = deepMerge(this.data, patch || {});
    // sanitize numeric fields
    const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
    next.port = num(next.port, 7963, 1024, 65535);
    next.launchDelaySec = num(next.launchDelaySec, 6, 0, 120);
    next.signInGapSec = num(next.signInGapSec, 120, 30, 600);
    next.launchTimeoutSec = num(next.launchTimeoutSec, 90, 15, 600);
    next.presencePollSec = next.presencePollSec ? num(next.presencePollSec, 30, 15, 600) : 0;
    if (typeof next.testClientPath !== 'string') throw new Error('Test Roblox executable must be a path');
    next.testClientPath = next.testClientPath.trim().replace(/^"(.*)"$/, '$1');
    next.tileColumns = num(next.tileColumns, 0, 0, 20);
    if (!['app', 'browser'].includes(next.windowMode)) next.windowMode = 'app';
    if (!['app', 'browser'].includes(next.loginWindow)) next.loginWindow = 'app';
    if (!['off', 'low', 'lowest'].includes(next.fastProfile)) next.fastProfile = 'off';
    if (!['auto', 'd3d11', 'vulkan', 'opengl'].includes(next.graphicsApi)) next.graphicsApi = 'auto';
    next.fpsCap = num(next.fpsCap, 0, 0, 1000);
    if (!['replace', 'skip', 'allow'].includes(next.onAlreadyRunning)) next.onAlreadyRunning = 'skip'; // invalid value: never the closing mode
    const w = next.watchdog;
    w.startOnEnable = !!w.startOnEnable;
    w.resumeAfterRestart = w.resumeAfterRestart !== false;
    w.tickSec = num(w.tickSec, 5, 2, 60);
    w.presenceIntervalSec = num(w.presenceIntervalSec, 45, 20, 600);
    w.graceSec = num(w.graceSec, 150, 30, 1200);
    w.badChecksToRestart = num(w.badChecksToRestart, 2, 1, 10);
    w.relaunchDelaySec = num(w.relaunchDelaySec, 15, 0, 600);
    w.killHungAfterSec = num(w.killHungAfterSec, 0, 0, 3600);
    w.maxRelaunchesPerHour = num(w.maxRelaunchesPerHour, 15, 1, 120);
    w.restartEveryMin = num(w.restartEveryMin, 0, 0, 1440);
    w.breakerDisconnects = num(w.breakerDisconnects, 4, 0, 50);
    w.breakerWindowMin = num(w.breakerWindowMin, 60, 5, 1440);
    {
      const x = next.executor || {};
      const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/^"(.*)"$/, '$1').slice(0, max) : '');
      const pth = str(x.path, 400);
      const fromPath = pth ? require('path').basename(pth) : '';
      const name = validName(fromPath) ? fromPath : (validName(str(x.processName, 60)) ? str(x.processName, 60) : 'Potassium.exe');
      if (pth && !validName(fromPath)) throw new Error('Executor location must point to the program (.exe)');
      const h = x.afterLaunch || {};
      const cmd = str(h.command, 400);
      if (cmd && !['.exe', '.bat', '.cmd', '.ps1'].includes(require('path').extname(cmd).toLowerCase())) throw new Error('The command after a launch must be a .exe, .bat, .cmd or .ps1 file');
      next.executor = { enabled: !!x.enabled, processName: name, path: pth, relaunch: !!x.relaunch, startWithManager: !!x.startWithManager, asAdmin: !!x.asAdmin, openBeforeClients: !!x.openBeforeClients, openWaitSec: num(x.openWaitSec, 15, 0, 120), taskPath: str(x.taskPath, 400), scriptsPath: str(x.scriptsPath, 400), afterLaunch: { command: cmd, args: str(h.args, 300), delaySec: num(h.delaySec, 20, 0, 600), rerunOnRestart: h.rerunOnRestart !== false } };
    }
    const g = next.captchaGuard;
    g.enabled = !!g.enabled;
    g.pauseAll = !!g.pauseAll;
    g.autoResumeMin = num(g.autoResumeMin, 0, 0, 1440);
    const a = next.antiAfk;
    a.intervalMin = num(a.intervalMin, 12, 1, 16);
    a.waitUserIdleSec = num(a.waitUserIdleSec, 4, 0, 60);
    if (!['space', 'wasd', 'rightclick', 'key'].includes(a.action)) a.action = 'space';
    a.key = String(a.key || '').slice(0, 3);
    if (a.action === 'key' && !/^([A-Za-z0-9]|[Ff]([1-9]|1\d|2[0-4]))$/.test(a.key)) throw new Error('Anti-AFK key must be A-Z, 0-9 or F1-F24');
    if (!['Normal', 'BelowNormal', 'Idle'].includes(next.clientPriority)) next.clientPriority = 'Normal';
    next.trimMemoryMin = num(next.trimMemoryMin, 0, 0, 120);
    next.trimWhenFreeBelowPct = num(next.trimWhenFreeBelowPct, 50, 5, 100);
    next.cpuCapPct = next.cpuCapPct ? num(next.cpuCapPct, 0, 2, 50) : 0;
    next.cpuCapSpareFront = next.cpuCapSpareFront !== false;
    next.closeAllKeepsMain = next.closeAllKeepsMain !== false;
    next.validateEveryHours = [0, 6, 12, 24].includes(Number(next.validateEveryHours)) ? Number(next.validateEveryHours) : 0;
    next.noPowerThrottle = !!next.noPowerThrottle;
    next.dryRun = !!next.dryRun;
    if (!Array.isArray(next.profiles)) next.profiles = [];
    { // hotkeys are stored in their normalized form; an invalid or duplicated one is refused, not silently dropped
      const { parseHotkey, hotkeyConflict } = require('./hotkey');
      const t = next.tray || {};
      const open = parseHotkey(t.hotkeyOpen); const closeAll = parseHotkey(t.hotkeyCloseAll);
      const conflict = hotkeyConflict(open, closeAll);
      if (conflict) throw new Error(conflict);
      next.tray = { enabled: !!t.enabled, hotkeyOpen: open ? open.label : '', hotkeyCloseAll: closeAll ? closeAll.label : '' };
    }
    { const sc = require('./schedule').normalize(next.schedule); next.schedule = { ...sc, days: sc.days.map((d) => (d === 0 ? 7 : d)).join('') }; }
    if (!['leave', 'park'].includes(next.minimizedAction)) next.minimizedAction = 'leave';
    next.graphicsLevel = num(next.graphicsLevel, 0, 0, 10);
    next.windowWidth = num(next.windowWidth, 0, 0, 7680);
    next.windowHeight = num(next.windowHeight, 0, 0, 4320);
    if ((next.windowWidth > 0 && next.windowWidth < 120) || (next.windowHeight > 0 && next.windowHeight < 80) || (next.windowWidth > 0) !== (next.windowHeight > 0)) { next.windowWidth = 0; next.windowHeight = 0; }
    if (!['none', 'all', 'background'].includes(next.muteMode)) next.muteMode = 'none';
    next.alerts.webhook = String(next.alerts.webhook || '').trim();
    if (next.alerts.webhook && !/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(next.alerts.webhook)) {
      throw new Error('Webhook must be a Discord webhook URL (https://discord.com/api/webhooks/...)');
    }
    next.alerts.mention = String(next.alerts.mention || '').slice(0, 100);
    next.alerts.cooldownMin = num(next.alerts.cooldownMin, 5, 0, 1440);
    { const q = next.alerts.quiet || {}; const ok = (t) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(t); next.alerts.quiet = { enabled: !!q.enabled, start: ok(q.start) ? q.start : '23:00', end: ok(q.end) ? q.end : '07:00' }; }
    w.disconnectGraceSec = num(w.disconnectGraceSec, 25, 10, 300);
    if (!Array.isArray(next.favorites)) next.favorites = [];
    next.favorites = next.favorites.slice(0, 50).map((f) => ({
      name: String(f.name || '').slice(0, 80), input: String(f.input || '').slice(0, 500),
      jobId: String(f.jobId || '').slice(0, 40), icon: /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(f.icon || '') ? f.icon : '',
    })).filter((f) => f.input);
    if (next.customFFlags) {
      try { JSON.parse(next.customFFlags); } catch { throw new Error('Custom FFlags must be valid JSON'); }
    }
    this.data = next;
    this.save();
    this.emit('change', this.data);
    return this.data;
  }
  save() { atomicWrite(FILE, JSON.stringify(this.data, null, 2)); }
  publicView() {
    const d = JSON.parse(JSON.stringify(this.data));
    d.api.passwordSet = !!d.api.password;
    d.api.password = '';
    return d;
  }
}

module.exports = { Settings, DEFAULTS };
