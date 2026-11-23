'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const EventEmitter = require('events');
const { api, RobloxError } = require('./roblox');
const { DATA, logger, sleep, atomicWrite, readJson } = require('./util');
const { buildFlags } = require('./fflags');

const log = logger('launcher');
const INSTANCES_FILE = path.join(DATA, 'instances.json');
const LOCK_STATUS = path.join(DATA, 'lockholder.json');
const LOCK_STOP = path.join(DATA, 'lockholder.stop');

// Roblox keeps the last session's cookie in LocalStorage\RobloxCookies.dat and rewrites it on every start and exit.
// A client that starts with another account's cookie in that file can have its ticket redeem refused (403).
// Clearing it right before a start means each client signs in from its own ticket. Running clients keep their
// session in memory, so this does not touch them.
function clearClientCookies() {
  const dir = process.env.IRAM_ROBLOX_DIR || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Roblox'));
  if (!dir) return;
  try { fs.unlinkSync(path.join(dir, 'LocalStorage', 'RobloxCookies.dat')); }
  catch (e) { if (e.code !== 'ENOENT') log.warn(`could not clear the Roblox cookie store: ${e.message}`); }
}
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------- target parsing ----------------
/**
 * Accepts: place id, game URL, private server URL (privateServerLinkCode), share links
 * (roblox.com/share?code=..&type=Server), roblox:// deep links, profile URLs, "@username"/"user:name" (follow).
 * Returns a normalized target: {type, placeId, jobId, linkCode, accessCode, userId, label}
 */
async function resolveTarget(input, { jobId, session } = {}) {
  let s = String(input || '').trim();
  jobId = String(jobId || '').trim();
  if (jobId && !GUID_RE.test(jobId)) throw new Error('Job ID must be a server GUID');
  if (!s) throw new Error('Enter a place ID / game link / private server link / @username');

  // follow user
  const fm = s.match(/^(?:@|user:|follow:)\s*([A-Za-z0-9_]{3,20})$/i);
  if (fm) {
    const u = await api.usernameToUser(session, fm[1]);
    return { type: 'follow', userId: u.id, label: `Follow ${u.name}` };
  }
  if (/^\d+$/.test(s)) {
    const placeId = Number(s);
    return jobId ? { type: 'job', placeId, jobId: jobId.toLowerCase(), label: `${placeId} / ${jobId.slice(0, 8)}` } : { type: 'game', placeId, label: String(placeId) };
  }
  if (/^roblox:\/\//i.test(s)) s = 'https://deeplink.local/?' + s.replace(/^roblox:\/\/(experiences\/start\?)?/i, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('Unrecognized link / ID'); }
  const q = u.searchParams;

  if (/\/share$/i.test(u.pathname) || q.get('type') === 'Server' && q.get('code')) {
    const code = q.get('code');
    if (!code) throw new Error('Share link has no code');
    const r = await api.resolveShareLink(session, code, q.get('type') || 'Server');
    if (r.linkCode) return { type: 'private', placeId: r.placeId, linkCode: r.linkCode, label: `Private ${r.placeId}` };
    return { type: 'game', placeId: r.placeId, label: String(r.placeId) };
  }
  const prof = u.pathname.match(/\/users\/(\d+)/i);
  if (prof) return { type: 'follow', userId: Number(prof[1]), label: `Follow ${prof[1]}` };

  const pm = u.pathname.match(/\/games\/(\d+)/i);
  const placeId = Number(pm ? pm[1] : (q.get('placeId') || q.get('placeid')));
  if (!placeId) throw new Error('Could not find a place ID in the link');
  const link = q.get('privateServerLinkCode') || q.get('linkCode');
  if (link) return { type: 'private', placeId, linkCode: link, label: `Private ${placeId}` };
  const access = q.get('accessCode');
  if (access) return { type: 'private', placeId, accessCode: access, label: `Private ${placeId}` };
  const gid = jobId || q.get('gameInstanceId') || q.get('gameId') || q.get('jobId');
  if (gid && GUID_RE.test(gid)) return { type: 'job', placeId, jobId: gid.toLowerCase(), label: `${placeId} / ${gid.slice(0, 8)}` };
  return { type: 'game', placeId, label: String(placeId) };
}

function placeLauncherUrl(t, btid) {
  const q = new URLSearchParams();
  const origin = { game: 'PlayButton', job: 'publicServerListJoin', private: 'privateServerListJoin', follow: 'followUser' }[t.type];
  switch (t.type) {
    case 'game': q.set('request', 'RequestGame'); q.set('placeId', t.placeId); break;
    case 'job': q.set('request', 'RequestGameJob'); q.set('placeId', t.placeId); q.set('gameId', t.jobId); break;
    case 'private':
      q.set('request', 'RequestPrivateGame'); q.set('placeId', t.placeId);
      if (t.linkCode) q.set('linkCode', t.linkCode); else q.set('accessCode', t.accessCode);
      break;
    case 'follow': q.set('request', 'RequestFollowUser'); q.set('userId', t.userId); break;
    default: throw new Error('bad target type ' + t.type);
  }
  q.set('browserTrackerId', btid);
  q.set('isPlayTogetherGame', 'false');
  q.set('joinAttemptId', crypto.randomUUID());
  q.set('joinAttemptOrigin', origin);
  return 'https://www.roblox.com/Game/PlaceLauncher.ashx?' + q.toString();
}

function launchUri(ticket, plUrl, btid) {
  return ['roblox-player:1', 'launchmode:play', `gameinfo:${ticket}`, `launchtime:${Date.now()}`,
    `placelauncherurl:${encodeURIComponent(plUrl)}`, `browsertrackerid:${btid}`,
    'robloxLocale:en_us', 'gameLocale:en_us', 'channel:', 'LaunchExp:InApp'].join('+');
}

// ---------------- Roblox install detection ----------------
const regDefaultCache = new Map();
function regDefault(key) {
  const hit = regDefaultCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const value = regDefaultUncached(key);
  regDefaultCache.set(key, { at: Date.now(), value });
  return value;
}
function regDefaultUncached(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.*)/);
    if (!m) return null;
    const v = m[1].trim();
    const q = v.match(/^"([^"]+)"/);
    return q ? q[1] : v.split(/\s+/)[0];
  } catch { return null; }
}

/** The RobloxPlayerBeta.exe Roblox's installer registered as the installed client, or null. */
// Registry lookups run `reg.exe` synchronously; cache them so each launch doesn't block the event loop.
let regClientCache = { at: 0, value: null };
function registeredClientExe() {
  if (Date.now() - regClientCache.at < 60000) return regClientCache.value;
  regClientCache = { at: Date.now(), value: registeredClientExeUncached() };
  return regClientCache.value;
}
function registeredClientExeUncached() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\ROBLOX Corporation\\Environments\\roblox-player', '/v', 'clientExe'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/clientExe\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    const p = m && m[1].trim().replace(/^"(.*)"$/, '$1');
    return p && /RobloxPlayerBeta\.exe$/i.test(p) && fs.existsSync(p) ? p : null;
  } catch { return null; }
}

function versionDirs() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Roblox', 'Versions'),
  ];
  const out = [];
  for (const r of roots) {
    let entries = [];
    try { entries = fs.readdirSync(r); } catch { continue; }
    for (const e of entries) {
      const exe = path.join(r, e, 'RobloxPlayerBeta.exe');
      try { out.push({ dir: path.join(r, e), exe, mtime: fs.statSync(exe).mtimeMs }); } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function detectRoblox(override, testClientPath) {
  if (testClientPath) {
    if (typeof testClientPath !== 'string' || !path.isAbsolute(testClientPath) ||
        path.basename(testClientPath).toLowerCase() !== 'robloxplayerbeta.exe') return null;
    try {
      if (fs.statSync(testClientPath).isFile()) {
        return { path: testClientPath, via: 'test executable', direct: true, testBuild: true };
      }
    } catch { /* missing or unreadable */ }
    return null;
  }
  if (override && fs.existsSync(override)) return { path: override, via: 'settings' };
  for (const key of ['HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command', 'HKCR\\roblox-player\\shell\\open\\command']) {
    const p = regDefault(key);
    if (p && fs.existsSync(p)) return { path: p, via: 'protocol handler' };
  }
  const v = versionDirs()[0];
  if (v) return { path: v.exe, via: 'Versions folder' };
  return null;
}

// ---------------- skip the launcher's update check ----------------
// RobloxPlayerLauncher.exe (the protocol handler) asks Roblox for the current version on every
// launch and installs it before starting the game. If the newest installed Versions folder already
// IS the current version, we can start RobloxPlayerBeta.exe directly and skip that step.
// If we're behind (or can't tell), we go through the launcher so it can update - Roblox's servers
// refuse outdated clients anyway.
const VERSION_URL = 'https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer';
const VERSION_CACHE_MS = 5 * 60 * 1000;
let versionCache = { value: null, at: 0 };
function resetVersionCache() { versionCache = { value: null, at: 0 }; }

/** Returns the current Windows client version string, e.g. "version-1a2b3c4d5e6f7a8b". */
async function currentRobloxVersion({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (versionCache.value && now - versionCache.at < VERSION_CACHE_MS) return versionCache.value;
  const res = await fetchImpl(VERSION_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`version check failed: HTTP ${res.status}`);
  const data = await res.json();
  const v = data && data.clientVersionUpload;
  if (typeof v !== 'string' || !/^version-[0-9a-f]+$/i.test(v)) throw new Error('version check returned an unexpected answer');
  versionCache = { value: v, at: now };
  return v;
}

/** Pure decision: the installed folder to launch directly, or null if none is current. */
function pickUpToDate(current, dirs) {
  if (!current) return null;
  return dirs.find((d) => path.basename(d.dir).toLowerCase() === current.toLowerCase()) || null;
}

/**
 * Like detectRoblox, but when skipUpdateCheck is on and the installed client is current,
 * returns RobloxPlayerBeta.exe directly so the launcher's update check is skipped.
 * With neverUpdate on, always returns the installed RobloxPlayerBeta.exe (the one Roblox registered,
 * else the newest folder) without going through the launcher. The client's own updater is disabled
 * separately (setUpdatersBlocked).
 */
async function resolveRoblox(override, { testClientPath = '', skipUpdateCheck = true, neverUpdate = false, fetchImpl, dirs, registered } = {}) {
  if (testClientPath) {
    const pinned = detectRoblox(override, testClientPath);
    if (pinned) return pinned;
    throw new Error('Test Roblox executable must point to an existing RobloxPlayerBeta.exe. Update or clear the path in Settings.');
  }
  if (override && fs.existsSync(override)) return { path: override, via: 'settings' };
  const installed = dirs || versionDirs();
  if (neverUpdate && installed.length) {
    // Keep starting the build Roblox registered as installed. With the updater blocked this never
    // changes, so the kept version is used even if its exe is older on disk than another folder's.
    const reg = registered === undefined ? registeredClientExe() : registered;
    const regDir = reg && path.dirname(reg).toLowerCase();
    const pinned = installed.find((d) => d.dir.toLowerCase() === regDir) || installed[0]; // else newest
    const version = path.basename(pinned.dir);
    try {
      const current = await currentRobloxVersion({ fetchImpl });
      if (current.toLowerCase() !== version.toLowerCase()) {
        log.warn(`starting ${version} (current is ${current}); updates are blocked, so Roblox may refuse the join (error 280)`);
      }
    } catch { /* the check is informational only; launch anyway */ }
    return { path: pinned.exe, via: `${version} (launcher skipped)`, direct: true, pinned: true };
  }
  if (skipUpdateCheck) {
    try {
      const current = await currentRobloxVersion({ fetchImpl });
      const hit = pickUpToDate(current, installed);
      if (hit) return { path: hit.exe, via: `${current} is current (update check skipped)`, direct: true };
      log.info(`installed client is not ${current}; using the launcher so it can update`);
    } catch (e) {
      log.warn(`could not check Roblox version (${e.message}); using the launcher`);
    }
  }
  return detectRoblox(override);
}

// ---------------- don't update Roblox ----------------
// RobloxPlayerBeta.exe checks its own version when it starts and, when it is outdated, runs the
// RobloxPlayerInstaller.exe next to it (older installs: RobloxPlayerLauncher.exe) to update.
// With "Don't update Roblox" on we rename those updaters inside every Player version folder so the
// client has nothing to run, and close any updater process that starts anyway (e.g. a fresh copy
// downloaded to %TEMP%). Turning the setting off renames them back.
const UPDATER_NAMES = ['RobloxPlayerInstaller.exe', 'RobloxPlayerLauncher.exe'];
const BLOCKED_SUFFIX = '.iram-blocked';

/**
 * Block (enabled=true) or restore (enabled=false) Roblox's updaters in the given version folders.
 * Returns {changed, failed}.
 */
function setUpdatersBlocked(enabled, dirs = versionDirs()) {
  let changed = 0;
  const failed = [];
  for (const d of dirs) {
    for (const name of UPDATER_NAMES) {
      const live = path.join(d.dir, name);
      const blocked = live + BLOCKED_SUFFIX;
      const [from, to] = enabled ? [live, blocked] : [blocked, live];
      if (!fs.existsSync(from)) continue;
      try {
        if (fs.existsSync(to)) fs.rmSync(to, { force: true });
        fs.renameSync(from, to);
        changed++;
      } catch (e) { failed.push(`${from}: ${e.code || e.message}`); }
    }
  }
  return { changed, failed };
}

/** Close running Roblox updater processes (best effort). Resolves to how many were closed. */
function killUpdaters() {
  return new Promise((resolve) => {
    const args = ['/F', ...UPDATER_NAMES.flatMap((n) => ['/IM', n])];
    let p;
    try { p = spawn('taskkill.exe', args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return resolve(0); }
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.on('error', () => resolve(0));
    p.on('close', () => resolve((out.match(/SUCCESS/gi) || []).length));
  });
}

// ---------------- launcher ----------------
function cancelledError(accountId) {
  return Object.assign(new Error('cancelled before it started'), { cancelled: true, accountId });
}

class Launcher extends EventEmitter {
  constructor({ helper, settings, accounts, guard = null }) {
    super();
    this.helper = helper;
    this.settings = settings;
    this.accounts = accounts;
    this.guard = guard; // CaptchaGuard: automated launches are refused while it is paused
    this.instances = new Map(); // pid -> {pid, accountId, btid, startedAt, target, reason, hwnd, memMB, hung, hungSince}
    this.btids = new Map();     // btid -> {accountId, at, target}
    this.unknown = [];          // Roblox processes we didn't launch
    this.queue = Promise.resolve();
    this.pending = new Map();   // accountId -> promise
    this.jobs = new Map();   // accountId -> { cancelled, started } for launches still in the queue
    this.holds = new Map();  // accountId -> time until keep-alive may not relaunch (set by a cancel)
    this.queued = [];           // accountIds waiting
    this.tombstones = new Map(); // pid -> time we killed it (never re-adopt a dying process)
    this.multiStatus = null;
    this.lastSync = 0;
  }

  async init() {
    const saved = readJson(INSTANCES_FILE, { instances: [], btids: [] });
    for (const [k, v] of saved.btids || []) this.btids.set(k, v);
    for (const i of saved.instances || []) this.instances.set(i.pid, i);
    await this.applyMulti();
    this.applyUpdateBlock();
    await this.sync();
    this.settings.on('change', () => {
      this.applyMulti().catch(() => {});
      this.applyUpdateBlock();
      try { this.applyFFlags(this.roblox()?.path); } catch (e) { log.warn('FFlags: ' + e.message); }
    });
    this.timer = setInterval(() => this.sync().catch((e) => log.debug('sync: ' + e.message)), 3000);
  }

  get multiActive() { return !!(this.multiStatus && this.multiStatus.wanted && this.multiStatus.mutex === 'held'); }

  /** Status written by the detached lock holder, or null if it isn't running. */
  lockStatus() {
    const s = readJson(LOCK_STATUS, null);
    if (!s || Date.now() - s.at > 15000) return null;
    try { process.kill(s.pid, 0); } catch (e) { if (e.code !== 'EPERM') return null; }
    return s;
  }

  /**
   * Multi-instance is provided by a detached lock-holder process (src/lockholder.ps1) that owns
   * ROBLOX_singletonMutex. It deliberately outlives the manager, so restarting or crashing the
   * manager never makes running clients close each other. Called on every sync (cheap).
   */
  async applyMulti() {
    const want = !!this.settings.get('multiInstance');
    let s = this.lockStatus();
    if (want) {
      try { fs.rmSync(LOCK_STOP, { force: true }); } catch {}
      if (!s && Date.now() - (this.holderSpawnedAt || 0) > 10000) {
        this.holderSpawnedAt = Date.now();
        // Start-Process gives the holder its own hidden console, so it is independent of ours
        // (Node's detached mode starts PowerShell with no console at all, and it exits at once).
        const q = (s) => s.replace(/'/g, "''");
        const cmd = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${q(path.join(__dirname, 'lockholder.ps1'))}" -DataDir "${q(DATA)}"'`;
        spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(cmd, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true });
        for (let i = 0; i < 40 && !s; i++) { await sleep(250); s = this.lockStatus(); }
      }
    } else if (s) {
      try { fs.writeFileSync(LOCK_STOP, '1'); } catch {}
    }
    const prev = this.multiStatus;
    const r = want ? { mutex: s ? s.mutex : 'lock holder not running', event: s ? s.event : '' } : { mutex: 'released', event: '' };
    this.multiStatus = { wanted: want, ...r };
    const changed = !prev || prev.wanted !== want || prev.mutex !== r.mutex;
    if (!changed) return;
    this.emit('change');
    if (!want) log.info('multi-instance disabled');
    else if (r.mutex === 'held') log.info('multi-instance active (singleton mutex owned)');
    else log.warn('multi-instance NOT active yet: a Roblox client that was started outside the manager (or before it) owns the singleton lock. Close all Roblox windows once; the manager takes the lock automatically.');
  }

  persist() {
    // keep only recent btids
    const cutoff = Date.now() - 3 * 864e5;
    for (const [k, v] of this.btids) if (v.at < cutoff) this.btids.delete(k);
    try {
      atomicWrite(INSTANCES_FILE, JSON.stringify({
        instances: [...this.instances.values()].map(({ pid, accountId, btid, startedAt, target, reason }) => ({ pid, accountId, btid, startedAt, target, reason })),
        btids: [...this.btids.entries()].slice(-500),
      }));
    } catch (e) { log.warn('persist failed: ' + e.message); }
  }

  /** Ignore a process we killed for 120s, but only that process: Windows can hand its pid to a new one. */
  isTombstoned(p) {
    const t = this.tombstones.get(p.pid);
    if (!t) return false;
    if (Date.now() - t.at > 120000) { this.tombstones.delete(p.pid); return false; }
    return !(t.start && p.start && t.start !== p.start);
  }

  byAccount(accountId) { return [...this.instances.values()].filter((i) => i.accountId === accountId); }

  windowTitle(acc) {
    return (this.settings.get('windowTitle') || '{name}')
      .replace(/\{name\}/g, this.accounts.displayName(acc))
      .replace(/\{username\}/g, acc.username)
      .replace(/\{alias\}/g, acc.alias || acc.username)
      .replace(/\{userId\}/g, String(acc.userId))
      .replace(/\{group\}/g, acc.group || '');
  }

  /** Reconcile tracked instances with real processes. */
  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      // do not block the sync on lock-holder startup (can take ~10s); the launch path awaits it itself
      if (!this.multiBusy) {
        this.multiBusy = true;
        this.applyMulti().catch((e) => log.debug('applyMulti: ' + e.message)).finally(() => { this.multiBusy = false; });
      }
      // taskkill is a process spawn: sweep for updaters every 20s, not on every 3s sync
      if (this.settings.get('neverUpdateRoblox') && Date.now() - (this.lastUpdaterSweep || 0) > 20000) {
        this.lastUpdaterSweep = Date.now();
        const n = await killUpdaters();
        if (n) log.warn(`closed ${n} Roblox updater process(es) ("Don't update Roblox" is on)`);
      }
      const procs = await this.helper.procs();
      // The helper can briefly return an empty list (restart, busy WMI). Treating that as "every client
      // closed" dropped all instances at once, and keep-alive then relaunched clients still running.
      // Two empty reads in a row are needed before anything is reconciled.
      if (!procs.length && this.instances.size) {
        this.emptyReads = (this.emptyReads || 0) + 1;
        if (this.emptyReads < 2) return;
      } else {
        this.emptyReads = 0;
      }
      const live = new Map(procs.map((p) => [p.pid, p]));
      let changed = false;
      for (const [pid, inst] of this.instances) {
        const p = live.get(pid);
        const mismatch = !!(p && inst.btid && p.btid && p.btid !== inst.btid);
        if (p && !mismatch) inst.missing = 0;
        if (!p || mismatch) {
          // Roblox's starter process often relaunches itself (new PID, same launch args).
          // Hand the instance over silently instead of reporting a crash.
          const heir = inst.btid && !inst.killReason && procs.find((q) => q.btid === inst.btid && q.pid !== pid && !this.instances.has(q.pid) && !this.isTombstoned(q));
          if (heir) {
            this.instances.delete(pid);
            inst.pid = heir.pid;
            inst.tunedPriority = null;
            this.instances.set(heir.pid, inst);
            changed = true;
            log.info(`pid ${pid} handed off to ${heir.pid} (${this.accounts.get(inst.accountId)?.username || inst.accountId})`);
            continue;
          }
          // one missed read is not an exit: wait for a second consecutive miss
          inst.missing = (inst.missing || 0) + 1;
          if (!inst.killReason && inst.missing < 2) continue;
          if (inst.btid && !inst.killReason && Date.now() - inst.startedAt < 20000) {
            // just launched: give the relaunched process a moment to appear before declaring exit
            continue;
          }
          this.instances.delete(pid);
          changed = true;
          log.info(`instance exited: pid ${pid} (${this.accounts.get(inst.accountId)?.username || inst.accountId})`);
          this.emit('exit', inst);
        }
      }
      // Adopt processes launched by us (incl. across manager restarts / slow starts).
      // Identity rules that keep accounts from ever being mixed up:
      //   - a process is only ever tied to an account through its unique launch tag (btid);
      //   - one launch tag = at most one instance (Roblox's starter + real client share a tag;
      //     the starter's exit is handled as a hand-off above, never as a second instance);
      //   - a process we killed is never adopted again while it is still shutting down.
      const trackedTags = new Set([...this.instances.values()].map((i) => i.btid).filter(Boolean));
      const byTag = new Map();
      for (const p of procs) {
        if (this.instances.has(p.pid) || !p.btid || trackedTags.has(p.btid) || this.isTombstoned(p)) continue;
        const prev = byTag.get(p.btid);
        if (!prev || Date.parse(p.start || 0) > Date.parse(prev.start || 0)) byTag.set(p.btid, p); // newest = real client
      }
      for (const p of byTag.values()) {
        const b = this.btids.get(p.btid);
        if (b && this.accounts.get(b.accountId)) {
          this.instances.set(p.pid, { pid: p.pid, accountId: b.accountId, btid: p.btid, startedAt: p.start ? Date.parse(p.start) : Date.now(), target: b.target, reason: 'adopted' });
          changed = true;
          log.info(`adopted pid ${p.pid} for ${this.accounts.get(b.accountId).username}`);
        }
      }
      const rename = this.settings.get('renameWindows');
      for (const inst of this.instances.values()) {
        const p = live.get(inst.pid);
        if (!p) continue; // in post-launch grace window
        inst.hwnd = p.hwnd; inst.memMB = p.memMB; inst.minimized = p.minimized;
        inst.hung = p.hung;
        inst.hungSince = p.hung ? (inst.hungSince || Date.now()) : null;
        const acc = this.accounts.get(inst.accountId);
        if (rename && acc && p.hwnd) {
          const want = this.windowTitle(acc);
          if (p.title !== want) this.helper.call('settitle', { hwnd: p.hwnd, title: want }).catch(() => {});
        }
      }
      this.unknown = procs.filter((p) => !this.instances.has(p.pid)).map((p) => ({ pid: p.pid, title: p.title, memMB: p.memMB, hwnd: p.hwnd }));
      // resource tuning: priority (re-applied if the setting changes) + periodic memory trim
      for (const inst of this.instances.values()) this.tuneInstance(inst);
      await this.applyAudio().catch((e) => log.debug('audio: ' + e.message));
      const trimMin = this.settings.get('trimMemoryMin');
      if (trimMin && Date.now() - (this.lastTrim || 0) > trimMin * 60000 && this.instances.size) {
        this.lastTrim = Date.now();
        this.helper.call('tune', { pids: [...this.instances.keys()], trim: true }).then((n) => log.info(`trimmed memory of ${n} client(s)`), () => {});
      }
      this.lastSync = Date.now();
      if (changed) this.persist();
      this.emit('change');
    } finally { this.syncing = false; }
  }

  /** Keep Roblox's own updaters disabled while "Don't update Roblox" is on; restore them when it is off. */
  applyUpdateBlock() {
    const want = !!this.settings.get('neverUpdateRoblox');
    if (!want && this.updatesBlocked === false) return; // already restored
    // Only undo a block this manager (this data folder) made, so a second copy of the manager with
    // the setting off never re-enables Roblox's updater behind the back of the one that has it on.
    const marker = path.join(DATA, 'updates-blocked');
    if (!want && !fs.existsSync(marker)) { this.updatesBlocked = false; return; }
    const { changed, failed } = setUpdatersBlocked(want);
    try { if (want) fs.writeFileSync(marker, '1'); else if (!failed.length) fs.rmSync(marker, { force: true }); } catch {}
    if (changed) log.info(want ? `blocked Roblox's updater in ${changed} place(s)` : `restored Roblox's updater in ${changed} place(s)`);
    for (const f of failed) log.warn(`could not ${want ? 'block' : 'restore'} Roblox updater ${f}`);
    this.updatesBlocked = want;
  }

  roblox() { return detectRoblox(this.settings.get('robloxPath'), this.settings.get('testClientPath')); }
  /** Used for launching: may skip the launcher's update check when the client is current. */
  resolveRoblox() {
    return resolveRoblox(this.settings.get('robloxPath'), {
      testClientPath: this.settings.get('testClientPath'),
      skipUpdateCheck: this.settings.get('skipUpdateCheck'),
      neverUpdate: this.settings.get('neverUpdateRoblox'),
    });
  }

  applyFFlags(exePath) {
    const flags = buildFlags({
      fastProfile: this.settings.get('fastProfile'),
      fpsCap: this.settings.get('fpsCap'),
      customFFlags: this.settings.get('customFFlags'),
    });
    // remove flags we wrote before but which are no longer configured
    const managedFile = path.join(DATA, 'fflags-managed.json');
    const prevManaged = readJson(managedFile, []);
    const removed = prevManaged.filter((k) => !(k in flags));
    if (!Object.keys(flags).length && !removed.length) return;
    const dirs = new Set(versionDirs().map((v) => v.dir));
    if (exePath && /RobloxPlayerBeta\.exe$/i.test(exePath)) dirs.add(path.dirname(exePath));
    for (const d of dirs) {
      try {
        const cs = path.join(d, 'ClientSettings');
        fs.mkdirSync(cs, { recursive: true });
        const f = path.join(cs, 'ClientAppSettings.json');
        const cur = readJson(f, {});
        const next = { ...cur, ...flags };
        for (const k of removed) delete next[k];
        if (JSON.stringify(cur) !== JSON.stringify(next)) atomicWrite(f, JSON.stringify(next, null, 2));
      } catch (e) { log.warn(`could not write FFlags in ${d}: ${e.message}`); }
    }
    try { atomicWrite(managedFile, JSON.stringify(Object.keys(flags))); } catch {}
  }

  /** Queue a launch. Launches run one at a time so process<->account mapping is unambiguous. */
  /**
   * Hard limit: one Roblox client at a time, whatever started it. Two clients signed in at once is what gets
   * accounts moderated, so this never lets a second client start. A client that is closing gets a short wait;
   * if one is still running after that, the launch is refused. If the process list can't be read, it is refused too.
   */
  async assertNoOtherClient() {
    const deadline = Date.now() + (this.clientWaitMs ?? 15000);
    for (;;) {
      const running = await this.helper.procs().catch(() => null);
      if (running === null) throw new Error('Could not read the running Roblox processes, so this launch was not started.');
      if (running.length === 0) return;
      if (Date.now() >= deadline) {
        throw new Error(`Another Roblox client is still running (${running.length}). The manager allows one client at a time, so close it first.`);
      }
      await sleep(500);
    }
  }

  launch(accountId, target, reason = 'manual', opts = {}) {
    if (this.pending.has(accountId)) return this.pending.get(accountId);
    if (['manual', 'rejoin', 'restart', 'hop'].includes(reason)) this.holds.delete(accountId); // only a person asking lifts a stop/cancel hold
    const job = { accountId, cancelled: false, started: false };
    this.jobs.set(accountId, job);
    this.queued.push(accountId);
    this.emit('change');
    const p = this.queue.then(() => {
      if (job.cancelled) throw cancelledError(accountId);
      return this._launch(accountId, target, reason, opts, job);
    });
    this.queue = p.catch(() => {});
    const done = () => {
      this.pending.delete(accountId);
      if (this.jobs.get(accountId) === job) this.jobs.delete(accountId);
      this.queued = this.queued.filter((x) => x !== accountId);
      this.emit('change');
    };
    p.then(done, done);
    this.pending.set(accountId, p);
    return p;
  }

  /** Cancel launches still waiting in the queue (ids = null cancels all). A cancelled account is not relaunched by keep-alive for 10 min. Returns how many. */
  cancelQueued(ids = null) {
    const want = ids ? new Set(ids) : null;
    let n = 0;
    for (const [accountId, job] of this.jobs) {
      if (want && !want.has(accountId)) continue;
      if (job.cancelled || job.started) continue; // a client already being started cannot be cancelled
      job.cancelled = true;
      this.holds.set(accountId, Date.now() + 10 * 60000);
      n++;
    }
    if (n) {
      this.queued = this.queued.filter((id) => !this.jobs.get(id)?.cancelled);
      log.info(`cancelled ${n} queued launch(es)`);
      this.emit('change');
    }
    return n;
  }

  /** Stop: cancel waiting launches and keep these accounts from being relaunched automatically for 10 min. ids = null means all. */
  stopAccounts(ids = null) {
    const list = ids || this.accounts.list.map((a) => a.id);
    for (const id of list) this.holds.set(id, Date.now() + 10 * 60000);
    return this.cancelQueued(ids);
  }

  /** True while keep-alive relaunches of this account are paused by a cancel. */
  isHeld(accountId) {
    const until = this.holds.get(accountId);
    if (!until) return false;
    if (Date.now() > until) { this.holds.delete(accountId); return false; }
    return true;
  }

  async _launch(accountId, target, reason, opts = {}, job = null) {
    const stillWanted = () => { if (job && job.cancelled) throw cancelledError(accountId); };
    const acc = this.accounts.get(accountId);
    if (!acc) throw new Error('account no longer exists');
    const name = acc.username;
    stillWanted();
    if (this.guard && this.guard.blocks(reason)) {
      throw Object.assign(new Error(`${name}: automatic launch skipped, the captcha guard has paused automation`), { guardPaused: true });
    }
    if (acc.status === 'verify') {
      throw Object.assign(new Error(`${name} needs verification: open it in the browser, complete the check, then click Validate`), { verification: true });
    }
    const existing = this.byAccount(accountId);
    const mode = opts.replace ? 'replace' : this.settings.get('onAlreadyRunning');
    if (existing.length && mode === 'skip') {
      log.info(`${name} already running; skipped`);
      return { pid: existing[0].pid, skipped: true };
    }
    const rbx = await this.resolveRoblox();
    if (!rbx) throw new Error('Roblox is not installed (could not find RobloxPlayerBeta / roblox-player handler)');
    if (existing.length && mode === 'replace') {
      log.info(`${name} already running; closing old client first`);
      await this.kill(existing.map((i) => i.pid), 'replaced'); // kill() already waits until the processes are gone
    }
    if (this.settings.get('multiInstance')) {
      await this.applyMulti();
      // Without the lock, starting another client would silently close the running ones.
      const others = [...this.instances.values()].filter((i) => i.accountId !== accountId).length + this.unknown.length;
      if (!this.multiActive && others > 0) {
        throw new Error('Multi-instance lock is held by a running Roblox client, so launching would close the others. Close all Roblox windows once (Clients -> Close ALL) and launch again.');
      }
    }
    this.applyFFlags(rbx.path);
    if (this.settings.get('neverUpdateRoblox')) {
      this.applyUpdateBlock(); // a version folder may have been installed since startup
      if (rbx.testBuild) setUpdatersBlocked(true, [{ dir: path.dirname(rbx.path) }]);
    }

    await this.assertNoOtherClient();
    // Read the process list before minting the ticket, not between minting and launching: a slow helper
    // call in between would leave the ticket stale by the time the client redeems it.
    const before = new Set((await this.helper.procs()).map((p) => p.pid));
    const session = this.accounts.session(acc);
    let ticket;
    try { ticket = await api.getAuthTicket(session); } catch (e) {
      if (e && e.verification) this.accounts.markVerification(acc, 'sign-in ticket');
      if (e && /moderat/i.test(String(e.message))) {
        // Roblox refuses tickets for moderated accounts. Retrying every 30 s only adds requests, so stop the account.
        this.accounts.setStatus(acc, 'banned', 'Roblox says this account is moderated, so it cannot join games');
        this.accounts.update(accountId, { keepAlive: { enabled: false } });
        this.accounts.save();
      }
      if (e instanceof RobloxError && e.status === 401) {
        this.accounts.setStatus(acc, 'invalid', 'Cookie expired or revoked - re-login needed'); this.accounts.save();
      }
      throw e;
    }
    stillWanted();
    const btid = `${Date.now()}${crypto.randomInt(100, 999)}`;
    const uri = launchUri(ticket, placeLauncherUrl(target, btid), btid);
    this.btids.set(btid, { accountId, at: Date.now(), target });
    this.persist();

    clearClientCookies();
    if (job) job.started = true; // the client is being started now: a cancel from here on has no effect
    log.info(`launching ${name} -> ${target.label || target.type} (${reason}) via ${rbx.via}`);
    try {
      const child = spawn(rbx.path, [uri], { detached: true, stdio: 'ignore', windowsHide: false,
        ...(rbx.testBuild ? { cwd: path.dirname(rbx.path) } : {}),
      });
      if (rbx.testBuild) {
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
      }
      child.on('error', (e) => log.error('spawn error: ' + e.message));
      child.unref();
    } catch (e) {
      if (rbx.testBuild) {
        this.btids.delete(btid);
        this.persist();
        throw new Error(`Could not start the Roblox test executable (${e.message})`, { cause: e });
      }
      log.warn(`direct spawn failed (${e.message}); falling back to protocol handler`);
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', uri], { detached: true, stdio: 'ignore' }).unref();
    }

    const deadline = Date.now() + this.settings.get('launchTimeoutSec') * 1000;
    let found = null;
    let pollMs = 300; // first look soon after spawn, then every 600ms (each look is one helper round trip)
    while (Date.now() < deadline) {
      await sleep(pollMs);
      pollMs = 600;
      const procs = await this.helper.procs().catch(() => []);
      const tagged = procs.filter((p) => p.btid === btid && !this.isTombstoned(p));
      found = tagged.sort((a, b) => Date.parse(b.start || 0) - Date.parse(a.start || 0))[0];
      // Untagged process (command line unreadable): accept it only when it is unambiguous -
      // exactly one new untagged Roblox process and no other launch still waiting to be matched.
      if (!found) {
        const untagged = procs.filter((p) => !p.btid && !before.has(p.pid) && !this.instances.has(p.pid) && !this.isTombstoned(p));
        const otherWaiting = [...this.btids.entries()].some(([t, v]) => t !== btid && Date.now() - v.at < 180000 && ![...this.instances.values()].some((i) => i.btid === t));
        if (untagged.length === 1 && !otherWaiting) found = untagged[0];
      }
      if (found) break;
    }
    if (!found) throw new Error(`Roblox did not start for ${name} within ${this.settings.get('launchTimeoutSec')}s (it will be adopted if it appears later)`);
    const inst = { pid: found.pid, accountId, btid, startedAt: Date.now(), target, reason, hwnd: found.hwnd };
    // the sync loop may already have adopted this launch (possibly under the starter's pid): replace, never duplicate
    for (const [pid, i] of this.instances) if (i.btid === btid) this.instances.delete(pid);
    this.instances.set(found.pid, inst);
    acc.lastUsedAt = Date.now();
    acc.lastTarget = target;
    this.accounts.save();
    this.persist();
    this.tuneInstance(inst);
    this.emit('launched', inst);
    log.info(`${name} running as pid ${found.pid}`);
    if (this.settings.get('autoTile')) setTimeout(() => this.tile().catch(() => {}), 8000);
    // spread joins a little so many accounts never hit Roblox at a perfectly regular rhythm
    const delay = this.settings.get('launchDelaySec') * 1000;
    if (delay) await sleep(Math.round(delay * (0.9 + Math.random() * 0.4)));
    return { pid: found.pid };
  }

  /** Where an account "is": its running client's target, else keep-alive target, else last launch. */
  currentTarget(acc) {
    const inst = this.byAccount(acc.id)[0];
    return (inst && inst.target) || (acc.keepAlive.enabled && acc.keepAlive.target) || acc.lastTarget || null;
  }

  /** Close and relaunch into the same target (works with or without keep-alive). */
  async restart(accountId) {
    const acc = this.accounts.get(accountId);
    if (!acc) throw new Error('account not found');
    const t = this.currentTarget(acc);
    if (!t) throw new Error(`${acc.username}: nothing to restart into (launch it once first)`);
    return this.launch(accountId, t, 'restart', { replace: true });
  }

  /**
   * Move an account to a different server of the same place. Picks a random non-full server that
   * isn't the current one (prefers servers with room for a party), then relaunches into it.
   * Keep-alive follows the account to the new server.
   */
  async serverHop(accountId, { preferSmall = false } = {}) {
    const acc = this.accounts.get(accountId);
    if (!acc) throw new Error('account not found');
    const session = this.accounts.session(acc);
    let t = this.currentTarget(acc);
    let placeId = t && t.placeId;
    let currentJob = t && t.jobId;
    try {
      const [p] = await api.getPresence(session, [acc.userId]);
      if (p && p.userPresenceType === 2) { placeId = p.placeId || placeId; currentJob = p.gameId || currentJob; }
    } catch {}
    if (!placeId) throw new Error(`${acc.username}: not in a game and no previous place to hop in`);
    const r = await api.getServers(session, placeId, { sortOrder: preferSmall ? 'Asc' : 'Desc', excludeFull: true });
    const open = (r.data || []).filter((s) => s.id !== currentJob && s.playing < s.maxPlayers - 1);
    if (!open.length) throw new Error('no other open servers found');
    const pool = open.slice(0, Math.max(5, Math.ceil(open.length / 3)));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const target = { type: 'job', placeId, jobId: pick.id, label: `${placeId} / ${pick.id.slice(0, 8)}` };
    if (acc.keepAlive.enabled) { acc.keepAlive.target = target; this.accounts.save(); }
    log.info(`${acc.username}: server hop -> ${pick.id.slice(0, 8)} (${pick.playing}/${pick.maxPlayers})`);
    return this.launch(accountId, target, 'server hop', { replace: true });
  }

  /**
   * Audio: muteMode 'all' mutes every client, 'background' lets only the focused client play sound.
   * Per-account override: fields.audio = 'mute' | 'unmute'. Re-applied every 15 s because Roblox
   * creates its audio session lazily (and re-creates it after a device change).
   * With mode 'none' we only undo mutes we applied ourselves, never touching the user's mixer.
   */
  async applyAudio() {
    const mode = this.settings.get('muteMode');
    const insts = [...this.instances.values()];
    if (!insts.length) return;
    let fgPid = 0;
    if (mode === 'background') { try { fgPid = (await this.helper.call('foreground')).pid; } catch {} }
    const now = Date.now();
    const refresh = now - (this.lastAudio || 0) > 15000;
    const groups = { true: [], false: [] };
    for (const inst of insts) {
      const acc = this.accounts.get(inst.accountId);
      const ov = acc && acc.fields && acc.fields.audio;
      let want = ov === 'mute' ? true : ov === 'unmute' ? false
        : mode === 'all' ? true : mode === 'background' ? inst.pid !== fgPid : null;
      if (want === null) { if (inst.muted) want = false; else continue; }
      if (want !== inst.muted || refresh) groups[want].push(inst);
    }
    if (refresh) this.lastAudio = now;
    for (const flag of [true, false]) {
      const list = groups[flag];
      if (!list.length) continue;
      await this.helper.call('mute', { pids: list.map((i) => i.pid), mute: flag });
      const changed = list.some((i) => i.muted !== flag);
      for (const i of list) i.muted = flag;
      if (changed) this.emit('change');
    }
  }

  /** Apply CPU priority to a client (memory trim is periodic, see sync()). */
  tuneInstance(inst) {
    const pr = this.settings.get('clientPriority');
    if (inst.tunedPriority === pr) return;
    inst.tunedPriority = pr;
    this.helper.call('tune', { pids: [inst.pid], priority: pr }).catch(() => {});
  }

  /**
   * Launch many accounts. sameServer: first account joins, its JobId is read from presence,
   * then the rest join that exact server.
   */
  async launchMany(ids, target, { sameServer = false, reason = 'manual' } = {}) {
    const results = [];
    if (!sameServer || target.type !== 'game' || ids.length < 2) {
      const ps = ids.map((id) => this.launch(id, target, reason).then((r) => ({ id, ok: true, ...r }), (e) => ({ id, ok: false, error: e.message, cancelled: !!e.cancelled })));
      return Promise.all(ps);
    }
    const [first, ...rest] = ids;
    try { results.push({ id: first, ok: true, ...(await this.launch(first, target, reason)) }); } catch (e) {
      return [{ id: first, ok: false, error: e.message }, ...rest.map((id) => ({ id, ok: false, error: 'first account failed' }))];
    }
    const acc = this.accounts.get(first);
    let jobId = null;
    const until = Date.now() + 120000;
    while (Date.now() < until && !jobId) {
      await sleep(5000);
      try {
        const [p] = await api.getPresence(this.accounts.session(acc), [acc.userId]);
        if (p && p.userPresenceType === 2 && p.gameId) jobId = p.gameId;
      } catch {}
    }
    const t2 = jobId ? { type: 'job', placeId: target.placeId, jobId, label: `${target.placeId} / ${jobId.slice(0, 8)}` } : { type: 'follow', userId: acc.userId, label: `Follow ${acc.username}` };
    log.info(jobId ? `same-server: joining ${jobId}` : 'same-server: could not read JobId, following first account instead');
    const ps = rest.map((id) => this.launch(id, t2, reason).then((r) => ({ id, ok: true, ...r }), (e) => ({ id, ok: false, error: e.message, cancelled: !!e.cancelled })));
    return results.concat(await Promise.all(ps));
  }

  /**
   * Roblox refused the sign-in ticket: the client logs "WebLogin HTTP error, statusCode: 403" and quits.
   * Replace it with a client that has a fresh ticket. At most 3 retries per account in 10 minutes, so a
   * refusal that never clears can't loop.
   */
  async retryAuth(inst) {
    if (inst.authHandled) return;
    inst.authHandled = true;
    // the person stopped this client (or stopped the account): a late 403 from it must not relaunch it
    if (inst.killReason || this.isHeld(inst.accountId)) return;
    const acc = this.accounts.get(inst.accountId);
    if (!acc) return;
    this.authRetries = this.authRetries || new Map();
    const recent = (this.authRetries.get(acc.id) || []).filter((t) => Date.now() - t < 600000);
    if (recent.length >= 2) {
      this.authRetries.set(acc.id, recent);
      log.error(acc.username + ': Roblox keeps refusing this sign-in (403) after ' + recent.length + ' fresh tickets. Not retrying. Check the account (Validate, or log in again).');
      this.emit('change');
      return;
    }
    recent.push(Date.now());
    this.authRetries.set(acc.id, recent);
    log.warn(acc.username + ': Roblox refused the sign-in ticket (403). Relaunching with a fresh ticket (' + recent.length + '/2).');
    await this.kill([inst.pid], 'sign-in refused');
    await sleep(this.authRetryDelayMs ?? (recent.length === 1 ? 10000 : 30000));
    if (this.isHeld(acc.id)) { log.info(acc.username + ': stopped while waiting to retry the sign-in; not relaunching'); return; }
    await this.launch(acc.id, inst.target || this.currentTarget(acc), 'sign-in retry', { replace: true })
      .catch((e) => log.error(acc.username + ': sign-in retry failed: ' + e.message));
  }

  async kill(pids, why = 'manual') {
    pids = [].concat(pids).filter(Boolean).map(Number);
    if (!pids.length) return 0;
    // One launch tag can cover more than one process (Roblox's starter + real client). Take the whole
    // tag down, or the survivor is adopted again on the next sync as a second instance of the same account.
    const procs = await this.helper.procs().catch(() => []);
    const tags = new Set(pids.map((pid) => this.instances.get(pid)?.btid).filter(Boolean));
    for (const p of procs) if (p.btid && tags.has(p.btid) && !pids.includes(p.pid)) pids.push(p.pid);
    const startOf = new Map(procs.map((p) => [p.pid, p.start || null]));
    for (const pid of pids) this.tombstones.set(pid, { at: Date.now(), start: startOf.get(pid) ?? null });
    const n = await this.helper.call('kill', { pids });
    // Forget only the processes that are really gone. A failed kill must not hide a live client.
    let alive = new Set();
    for (let i = 0; i < 8; i++) {
      alive = new Set((await this.helper.procs().catch(() => [])).map((p) => p.pid));
      if (!pids.some((pid) => alive.has(pid))) break;
      await sleep(250);
    }
    for (const pid of pids) {
      if (alive.has(pid)) continue;
      const inst = this.instances.get(pid);
      if (inst) { this.instances.delete(pid); inst.killReason = why; this.emit('exit', inst); }
    }
    this.persist();
    this.emit('change');
    log.info(`killed ${n} process(es) (${why})`);
    return n;
  }

  /**
   * Quit support: optionally close every Roblox client, then stop the multi-instance lock holder
   * when no client is left to protect. With clients still running the holder must stay, or the
   * clients would close each other; it then exits on its own once the last client closes.
   * Returns {clientsLeft, lockHolder: 'stopped' | 'kept' | 'not running'}.
   */
  async stopBackground({ closeClients = false } = {}) {
    if (closeClients) {
      try { await this.killAll(true); } catch (e) { log.warn('close clients on quit: ' + e.message); }
      for (let i = 0; i < 10; i++) {
        const left = await this.helper.procs().catch(() => []);
        if (!left.length) break;
        await sleep(300);
      }
    }
    const procs = await this.helper.procs().catch(() => null);
    const clientsLeft = procs ? procs.length : null;
    let s = this.lockStatus();
    if (!s) return { clientsLeft, lockHolder: 'not running' };
    if (clientsLeft !== 0) {
      log.info(`lock holder kept running to protect ${clientsLeft ?? 'running'} Roblox client(s); it exits after the last one closes`);
      return { clientsLeft, lockHolder: 'kept' };
    }
    try { fs.writeFileSync(LOCK_STOP, '1'); } catch {}
    for (let i = 0; i < 20 && s; i++) { await sleep(250); s = this.lockStatus(); }
    if (s) { try { process.kill(s.pid); } catch {} }
    log.info('lock holder stopped');
    return { clientsLeft, lockHolder: 'stopped' };
  }

  async killAll(includeUnknown = true) {
    const pids = [...this.instances.keys(), ...(includeUnknown ? this.unknown.map((u) => u.pid) : [])];
    return this.kill(pids, 'close all');
  }

  async tile() {
    const order = new Map(this.accounts.list.map((a, i) => [a.id, i]));
    const hwnds = [...this.instances.values()].filter((i) => i.hwnd)
      .sort((a, b) => (order.get(a.accountId) ?? 999) - (order.get(b.accountId) ?? 999)).map((i) => i.hwnd);
    return this.helper.call('tile', { hwnds, cols: this.settings.get('tileColumns') });
  }

  async windowCmd(pid, cmd) {
    const inst = this.instances.get(Number(pid)) || this.unknown.find((u) => u.pid === Number(pid));
    if (!inst || !inst.hwnd) throw new Error('window not found');
    if (cmd === 'focus') return this.helper.call('focus', { hwnd: inst.hwnd });
    return this.helper.call('show', { hwnd: inst.hwnd, mode: cmd === 'minimize' ? 6 : 9 });
  }

  publicView() {
    return {
      instances: [...this.instances.values()].map((i) => ({
        pid: i.pid, accountId: i.accountId, startedAt: i.startedAt, target: i.target, reason: i.reason,
        memMB: i.memMB, hung: i.hung, minimized: i.minimized, muted: !!i.muted, verified: i.verified ?? null,
        log: i.logState ? { inGame: i.logState.inGame, jobId: i.logState.jobId, placeId: i.logState.placeId, reason: i.logState.reason, disconnectedAt: i.logState.disconnectedAt || 0 } : null,
      })),
      unknown: this.unknown,
      queued: this.queued,
      multi: this.multiStatus,
    };
  }

  stop() { clearInterval(this.timer); this.persist(); }
}

module.exports = { Launcher, resolveTarget, placeLauncherUrl, launchUri, detectRoblox, resolveRoblox, pickUpToDate, currentRobloxVersion, resetVersionCache, setUpdatersBlocked, BLOCKED_SUFFIX };
