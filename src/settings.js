'use strict';
const path = require('path');
const EventEmitter = require('events');
const { DATA, atomicWrite, readJson, deepMerge } = require('./util');

const FILE = path.join(DATA, 'settings.json');

const DEFAULTS = {
  port: 7963,
  openUiOnStart: true,
  autoValidateOnStart: true,

  // launching
  multiInstance: true,
  launchDelaySec: 6,           // gap between consecutive launches (Roblox rate-limits rapid joins)
  launchTimeoutSec: 90,        // how long to wait for the Roblox process to appear
  onAlreadyRunning: 'replace', // 'replace' | 'skip' | 'allow'
  robloxPath: '',              // blank = auto-detect (registry handler / Versions folder)
  neverUpdateRoblox: false,    // start the newest installed client directly, never via the launcher (the client can still update itself)
  skipUpdateCheck: true,       // launch RobloxPlayerBeta.exe directly when the installed version is current
  renameWindows: true,
  windowTitle: '{name}',       // {name} {username} {alias} {userId} {group}
  autoTile: false,
  tileColumns: 0,              // 0 = auto
  fpsCap: 0,                   // 0 = don't touch ClientAppSettings
  customFFlags: '',            // raw JSON merged into ClientAppSettings.json

  // keep-alive watchdog
  watchdog: {
    enabled: true,
    tickSec: 5,
    presenceCheck: true,
    presenceIntervalSec: 45,
    graceSec: 150,             // don't judge presence right after launch
    badChecksToRestart: 2,
    disconnectGraceSec: 25,    // log says disconnected and no rejoin within this -> restart
    relaunchDelaySec: 8,
    killHungAfterSec: 120,
    maxRelaunchesPerHour: 15,
    fallbackToPublic: true,    // if a specific JobId keeps failing, join any server instead
    restartEveryMin: 0,        // 0 = never; otherwise scheduled restart of keep-alive clients
  },

  // anti-AFK: Roblox kicks after 20 idle minutes
  antiAfk: {
    enabled: true,
    intervalMin: 12,           // nudge each client this often (max 16 so the +3 min grace stays under 20)
    action: 'space',           // 'space' (jump) | 'wasd' (step fwd+back) | 'rightclick' (camera) | 'key'
    key: '',                   // used when action = 'key' (A-Z, 0-9, F1-F24)
    waitUserIdleSec: 4,        // wait until you've paused input this long (max delay: 3 min)
    includeUntracked: false,   // also nudge Roblox windows not started by the manager
  },

  // per-client resource tuning
  clientPriority: 'Normal',    // Normal | BelowNormal | Idle
  trimMemoryMin: 0,            // empty clients' working sets every N min (0 = off)

  favorites: [],               // [{name, input, jobId, icon}]

  // audio: 'none' | 'all' (mute every client) | 'background' (only the focused client plays sound)
  muteMode: 'none',

  alerts: {
    webhook: '',               // Discord webhook URL
    mention: '',               // e.g. <@123> - pinged on errors only
    cooldownMin: 5,            // same alert for the same account at most once per N minutes
    events: { crash: true, disconnect: true, sameAccount: true, invalid: true, throttled: true, launchFail: false },
  },

  startWithWindows: false,

  browserPath: '',             // blank = Edge, then Chrome

  api: {
    enabled: false,
    password: '',
    allowCookieExport: false,
  },
};

class Settings extends EventEmitter {
  constructor() {
    super();
    this.data = deepMerge(DEFAULTS, readJson(FILE, {}));
  }
  get(k) { return k ? this.data[k] : this.data; }
  update(patch) {
    const next = deepMerge(this.data, patch || {});
    // sanitize numeric fields
    const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
    next.port = num(next.port, 7963, 1024, 65535);
    next.launchDelaySec = num(next.launchDelaySec, 6, 0, 120);
    next.launchTimeoutSec = num(next.launchTimeoutSec, 90, 15, 600);
    next.tileColumns = num(next.tileColumns, 0, 0, 20);
    next.fpsCap = num(next.fpsCap, 0, 0, 1000);
    if (!['replace', 'skip', 'allow'].includes(next.onAlreadyRunning)) next.onAlreadyRunning = 'replace';
    const w = next.watchdog;
    w.tickSec = num(w.tickSec, 5, 2, 60);
    w.presenceIntervalSec = num(w.presenceIntervalSec, 45, 20, 600);
    w.graceSec = num(w.graceSec, 150, 30, 1200);
    w.badChecksToRestart = num(w.badChecksToRestart, 2, 1, 10);
    w.relaunchDelaySec = num(w.relaunchDelaySec, 8, 0, 600);
    w.killHungAfterSec = num(w.killHungAfterSec, 120, 0, 3600);
    w.maxRelaunchesPerHour = num(w.maxRelaunchesPerHour, 15, 1, 120);
    w.restartEveryMin = num(w.restartEveryMin, 0, 0, 1440);
    const a = next.antiAfk;
    a.intervalMin = num(a.intervalMin, 12, 1, 16);
    a.waitUserIdleSec = num(a.waitUserIdleSec, 4, 0, 60);
    if (!['space', 'wasd', 'rightclick', 'key'].includes(a.action)) a.action = 'space';
    a.key = String(a.key || '').slice(0, 3);
    if (a.action === 'key' && !/^([A-Za-z0-9]|[Ff]([1-9]|1\d|2[0-4]))$/.test(a.key)) throw new Error('Anti-AFK key must be A-Z, 0-9 or F1-F24');
    if (!['Normal', 'BelowNormal', 'Idle'].includes(next.clientPriority)) next.clientPriority = 'Normal';
    next.trimMemoryMin = num(next.trimMemoryMin, 0, 0, 120);
    if (!['none', 'all', 'background'].includes(next.muteMode)) next.muteMode = 'none';
    next.alerts.webhook = String(next.alerts.webhook || '').trim();
    if (next.alerts.webhook && !/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(next.alerts.webhook)) {
      throw new Error('Webhook must be a Discord webhook URL (https://discord.com/api/webhooks/...)');
    }
    next.alerts.mention = String(next.alerts.mention || '').slice(0, 100);
    next.alerts.cooldownMin = num(next.alerts.cooldownMin, 5, 0, 1440);
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
