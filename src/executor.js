'use strict';
// Executor handling: process management for the script executor the person runs next to the clients (any executor: Potassium, Volt, Madium, Real, others).
// It watches the executor process, brings it back if it closes after it was running, can start it with the manager, can pause
// it on purpose for an A/B round, and can run a command of the person's own after each client launches (for example to
// re-attach). It never touches a Roblox client, injects anything or reads another process's memory.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { logger, sleep } = require('./util');
const log = logger('executor');

const NAME_RE = /^[A-Za-z0-9 _.\-]{1,60}\.exe$/;
const HOOK_EXT = new Set(['.exe', '.bat', '.cmd', '.ps1']);
const RELAUNCH_CAP_PER_HOUR = 4;
const RETRY_MS = 20e3;
const TICK_MS = 10e3;
const HOOK_TIMEOUT_MS = 120e3;
const DOWN_ALERT_MS = 90e3;   // closed (and not back) for this long while clients are running: tell the person

const validName = (n) => typeof n === 'string' && NAME_RE.test(n.trim());

// Name hints only, used to label programs the person already has open. Matching looks at how the program name starts.
// Whatever the person picks is accepted whatever it is called, so an executor that is not in this list works the same way.
const PROFILES = [
  { id: 'potassium', label: 'Potassium', key: 'potassium' },
  { id: 'volt', label: 'Volt', key: 'volt' },
  { id: 'madium', label: 'Madium', key: 'madium' },
  { id: 'real', label: 'Real', key: 'real' },
];
const LOOKALIKES = /^(realtek|realplayer|realsense|realvnc|realterm|realmedia)/i;
// Windows and everyday programs that are never an executor, so the list of open programs stays short.
const SYSTEM_PROGRAMS = new Set(['system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'svchost', 'fontdrvhost', 'dwm', 'winlogon', 'explorer',
  'conhost', 'taskhostw', 'sihost', 'runtimebroker', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'textinputhost', 'ctfmon', 'spoolsv', 'audiodg',
  'wudfhost', 'dllhost', 'node', 'powershell', 'pwsh', 'cmd', 'tasklist', 'taskmgr', '10k-window', 'chrome', 'msedge', 'msedgewebview2', 'firefox', 'brave',
  'robloxplayerbeta', 'robloxplayerlauncher', 'robloxcrashhandler', 'securityhealthservice', 'securityhealthsystray', 'memory compression', 'system idle process',
  'applicationframehost', 'shellexperiencehost', 'lockapp', 'smartscreen', 'backgroundtaskhost', 'wmiprvse', 'dashost', 'unsecapp', 'discord', 'spotify',
  'steam', 'steamwebhelper', 'code', 'claude', 'onedrive', 'widgets', 'phoneexperiencehost', 'useroobebroker', 'ngciso', 'nissrv', 'msmpeng', 'mpdefendercoreservice']);

/** Pure: a known executor name (Potassium, Volt, Madium, Real) from a program name, or null. */
function profileOf(name) {
  const stem = String(name || '').replace(/\.exe$/i, '').toLowerCase();
  if (!stem || LOOKALIKES.test(stem)) return null;
  const p = PROFILES.find((x) => stem.startsWith(x.key));
  return p ? { id: p.id, label: p.label } : null;
}

/** Pure: parseTasklist() output -> programs the person may pick from. Same-name processes are grouped, known executors come first. */
function listPrograms(procs, limit = 40) {
  const by = new Map();
  for (const p of procs || []) {
    if (!validName(p.name)) continue;
    const key = p.name.toLowerCase();
    const prof = profileOf(p.name);
    if (!prof && SYSTEM_PROGRAMS.has(key.replace(/\.exe$/, ''))) continue;
    const e = by.get(key) || { name: p.name, count: 0, memMB: 0, profile: prof ? prof.label : '' };
    e.count++;
    e.memMB += p.memMB || 0;
    by.set(key, e);
  }
  return [...by.values()].sort((a, b) => (b.profile ? 1 : 0) - (a.profile ? 1 : 0) || b.memMB - a.memMB).slice(0, limit);
}

const NEEDS_ADMIN = 'needs-admin';
// One-time setup: two scheduled tasks that run with the highest privileges. Starting an existing task needs no Windows prompt, so
// afterwards the manager (which is not elevated) can open and close an executor that runs as administrator on its own.
const TASK_OPEN = 'IRAM Executor Open';
const TASK_CLOSE = 'IRAM Executor Close';

const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** Pure: the PowerShell script, run once as administrator, that creates the two tasks. */
function buildTaskScript({ user, exe, name }) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  $principal = New-ScheduledTaskPrincipal -UserId ' + psq(user) + ' -LogonType Interactive -RunLevel Highest',
    '  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew',
    '  $open = New-ScheduledTaskAction -Execute ' + psq(exe) + ' -WorkingDirectory ' + psq(path.dirname(exe)),
    "  $close = New-ScheduledTaskAction -Execute 'taskkill.exe' -Argument " + psq('/F /IM "' + name + '"'),
    '  Register-ScheduledTask -TaskName ' + psq(TASK_OPEN) + ' -Action $open -Principal $principal -Settings $settings -Force | Out-Null',
    '  Register-ScheduledTask -TaskName ' + psq(TASK_CLOSE) + ' -Action $close -Principal $principal -Settings $settings -Force | Out-Null',
    '  exit 0',
    '} catch {',
    '  $_ | Out-String | Set-Content -LiteralPath (Join-Path $env:TEMP "iram-task-error.txt")',
    '  exit 1',
    '}',
  ].join('\r\n');
}

/** Pure: the script that removes both tasks again. */
function buildTaskRemoveScript() {
  return [TASK_OPEN, TASK_CLOSE].map((n) => 'Unregister-ScheduledTask -TaskName ' + psq(n) + ' -Confirm:$false -ErrorAction SilentlyContinue').join('\r\n') + '\r\nexit 0';
}
const IGNORED_FILES = /^(unins\d*|uninstall.*|vc_redist.*|crashpad_handler|crashreporter|setup|update(r)?)\.exe$/i;

/** Pure: `tasklist /FO CSV /NH` output -> [{ pid, memMB }]. Memory is read as digits only, so any Windows language works. */
function parseTasklist(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"\s*$/);
    if (!m) continue;
    const kb = Number(m[3].replace(/\D/g, ''));
    out.push({ name: m[1], pid: Number(m[2]), memMB: Number.isFinite(kb) ? Math.round(kb / 1024) : 0 });
  }
  return out;
}

/** Pure: splits a command line into arguments, keeping "quoted parts" together. */
function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out.slice(0, 20);
}

/**
 * Pure: what should happen on this tick. `s` = { running: number of executor processes, seen: it was running at some point,
 * held: closed on purpose, startedOnce: started with the manager already, pathOk, now, nextAttemptAt, relaunches: [timestamps] }.
 * Returns { status, msg, action }, where action is 'start' or undefined.
 */
function decide(cfg, s) {
  if (!cfg.enabled) return { status: 'off', msg: '' };
  if (s.running > 0) {
    // An executor that runs as administrator hides its location from a normal program, so it cannot be learned.
    return { status: 'running', msg: s.pathOk ? '' : 'Location unknown (it may run as administrator). Enter it in Settings so it can be opened again' };
  }
  if (s.held) return { status: 'held', msg: 'Closed on purpose for an experiment round' };
  const again = s.seen && cfg.relaunch;
  const first = cfg.startWithManager && !s.startedOnce && !s.seen;
  if (!again && !first) {
    return s.seen
      ? { status: 'closed', msg: 'Closed. Relaunch is off, so it stays closed' }
      : { status: 'standby', msg: 'Waiting for you to open it. It is brought back only after it was open and closed' };
  }
  if (!s.pathOk) return { status: 'error', msg: 'The executor path is not known yet. Open it once while the manager runs and it is learned, or enter it in Settings' };
  const recent = (s.relaunches || []).filter((t) => s.now - t < 3600e3);
  if (recent.length >= RELAUNCH_CAP_PER_HOUR) return { status: 'throttled', msg: `Started ${recent.length} times in the last hour. Check why it keeps closing` };
  if (s.now < s.nextAttemptAt) return { status: 'waiting', msg: `Starting again in ${Math.ceil((s.nextAttemptAt - s.now) / 1000)}s` };
  return { status: 'starting', msg: '', action: 'start' };
}

function run(file, args, opts) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

class Executor extends EventEmitter {
  constructor({ settings, launcher = null, accounts = null, alerts = null }) {
    super();
    this.alerts = alerts || { send() {} };
    this.wasRunning = null;   // null until it was seen once; then true/false
    this.wentDown = false;    // it was open, then closed: when it is back, clients that run now need the after-launch command again
    this.downSince = 0;
    this.alertedDown = false;
    this.settings = settings;
    this.launcher = launcher;
    this.accounts = accounts;
    this.timer = null;
    this.seen = false;
    this.held = false;
    this.startedOnce = false;
    this.nextAttemptAt = 0;
    this.relaunches = [];
    this.lastName = '';
    this.probedPid = 0;
    this.looksElevated = false;
    this.ensuring = null;
    this.pollMs = 1000;
    this.settleMs = 3000;
    this.tasks = { open: false, close: false, at: 0 };
    this.view = { status: 'off', msg: '', pid: 0, memMB: 0 };
    this.hook = { runs: 0, lastAt: 0, ok: null, msg: '' };
    this.hookQueue = Promise.resolve();
    this.busy = false;
  }

  cfg() { return this.settings.get('executor') || {}; }
  name() {
    const p = String(this.cfg().path || '').trim();
    const fromPath = p ? path.basename(p) : '';
    if (validName(fromPath)) return fromPath;
    const n = String(this.cfg().processName || '').trim();
    return validName(n) ? n : 'Potassium.exe';
  }

  start() {
    if (this.launcher) this.launcher.on('launched', (inst) => this.queueHook(inst));
    const loop = async () => {
      try { await this.tick(); } catch (e) { log.error('tick: ' + e.message); }
      this.timer = setTimeout(loop, TICK_MS);
    };
    this.timer = setTimeout(loop, 4000);
  }
  stopWatching() { clearTimeout(this.timer); }

  async find() {
    const r = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${this.name()}`, '/FO', 'CSV', '/NH'], { timeout: 8000 });
    return parseTasklist(r.stdout).filter((p) => p.name.toLowerCase() === this.name().toLowerCase());
  }

  pathOk() {
    const p = String(this.cfg().path || '');
    return !!p && path.basename(p).toLowerCase() === this.name().toLowerCase() && fs.existsSync(p);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const cfg = this.cfg();
      await this.checkTasks();
      if (!cfg.enabled) { this.setView({ status: 'off', msg: '', pid: 0, memMB: 0 }); return; }
      const nm = this.name();
      if (nm !== this.lastName) { // another executor was chosen: forget what was known about the previous one
        this.lastName = nm; this.seen = false; this.startedOnce = false; this.probedPid = 0; this.looksElevated = false; this.nextAttemptAt = 0;
        this.wasRunning = null; this.wentDown = false; this.downSince = 0; this.alertedDown = false;
      }
      const procs = await this.find();
      this.track(procs.length);
      if (procs.length) {
        this.seen = true;
        await this.probe(procs[0].pid);
      }
      const d = decide(cfg, { running: procs.length, seen: this.seen, held: this.held, startedOnce: this.startedOnce, pathOk: this.pathOk(), now: Date.now(), nextAttemptAt: this.nextAttemptAt, relaunches: this.relaunches });
      let v = { status: d.status, msg: d.msg, pid: procs[0] ? procs[0].pid : 0, memMB: procs.reduce((a, p) => a + p.memMB, 0) };
      if (d.action === 'start') {
        const e = await this.launch();
        v = e ? { ...v, status: 'error', msg: e } : { ...v, status: 'starting', msg: 'Started' };
      }
      this.setView(v);
    } finally { this.busy = false; }
  }

  /**
   * Notices an executor that was open and closed, and what that means for the clients running at that moment.
   *  - When it is back: the after-launch command (your re-attach file) runs again for every running client, one after another,
   *    because a restarted executor does not know the clients that were already open. Off with afterLaunch.rerunOnRestart.
   *  - When it stays closed for 90 s while clients run: one Discord alert (event "executor"), so a farm does not sit for hours
   *    without its executor. Not while it is closed on purpose for an experiment round.
   */
  track(count, now = Date.now()) {
    if (count > 0) {
      const wasDown = this.wentDown;
      this.wentDown = false; this.wasRunning = true; this.downSince = 0; this.alertedDown = false;
      if (wasDown) this.reattachAll();
      return;
    }
    if (this.wasRunning) { this.wasRunning = false; this.wentDown = true; this.downSince = now; }
    if (!this.wentDown || this.alertedDown || this.held || !this.downSince || now - this.downSince < DOWN_ALERT_MS) return;
    const clients = this.launcher && this.launcher.instances ? this.launcher.instances.size : 0;
    if (!clients) return;
    this.alertedDown = true;
    const nm = this.name().replace(/\.exe$/i, '');
    log.warn(`${nm} has been closed for ${Math.round((now - this.downSince) / 1000)}s while ${clients} client(s) run`);
    this.alerts.send('executor', `${nm} is not running`, `${nm} closed and has not come back, and ${clients} Roblox client(s) are running without it.${this.cfg().relaunch ? ' The manager keeps trying to open it again.' : ' Opening it again is off in Settings.'}`, { key: 'executor' });
  }

  /** Runs the after-launch command again for every client that is open now. Returns how many were queued. */
  reattachAll() {
    const c = this.cfg();
    const h = c.afterLaunch || {};
    if (!c.enabled || !String(h.command || '').trim() || h.rerunOnRestart === false || !this.launcher || !this.launcher.instances) return 0;
    const insts = [...this.launcher.instances.values()];
    for (const inst of insts) this.queueHook(inst);
    if (insts.length) log.info(`the executor is back: running the after-launch command again for ${insts.length} client(s)`);
    return insts.length;
  }

  setView(v) {
    if (v.status !== this.view.status || v.msg !== this.view.msg || v.pid !== this.view.pid || Math.abs((v.memMB || 0) - (this.view.memMB || 0)) >= 20) {
      this.view = v;
      this.emit('change');
    }
  }

  /**
   * Reads where the running program lives, once per process. A program that runs as administrator hides this from a normal
   * program: that is how it is recognised, and it is then opened as administrator too when it has to be brought back.
   */
  async probe(pid) {
    if (pid === this.probedPid) return;
    this.probedPid = pid;
    const id = Math.trunc(Number(pid));
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${id} -ErrorAction SilentlyContinue; if (-not $p) { 'GONE' } else { $p.Path }`], { timeout: 10000 });
    const p = r.stdout.trim().split(/\r?\n/)[0] || '';
    if (p === 'GONE') { this.probedPid = 0; return; }
    if (!p) { this.looksElevated = true; return; }
    this.looksElevated = false;
    if (!this.pathOk() && path.basename(p).toLowerCase() === this.name().toLowerCase() && fs.existsSync(p)) {
      try { this.settings.update({ executor: { path: p } }); log.info('learned the executor path from the running process'); } catch (e) { log.warn('could not save executor path: ' + e.message); }
    }
  }

  /** Starts the executor from its saved path. Returns an error text, or '' when it was started. */
  async launch() {
    if (!this.pathOk()) return 'The executor path is not set';
    const p = this.cfg().path;
    this.relaunches = this.relaunches.filter((t) => Date.now() - t < 3600e3);
    this.relaunches.push(Date.now());
    this.nextAttemptAt = Date.now() + RETRY_MS;
    this.startedOnce = true;
    if (this.cfg().asAdmin || this.looksElevated) return this.elevatedStart(p);
    const e = await this.startPlain(p);
    if (e !== NEEDS_ADMIN) return e;
    const again = await this.elevatedStart(p);
    if (!again) { this.looksElevated = true; log.info('the executor needs administrator rights, so it is opened that way from now on'); }
    return again;
  }

  // ----- one-time administrator setup (scheduled tasks) -----
  taskReady(kind) {
    const c = this.cfg();
    return !!c.taskPath && c.taskPath === c.path && !!this.tasks[kind];
  }

  /** 'ready' = both tasks exist for the current program, 'stale' = they exist for another program, 'none'. */
  taskState() {
    if (this.taskReady('open') && this.taskReady('close')) return 'ready';
    return this.tasks.open || this.tasks.close ? 'stale' : 'none';
  }

  /** Looks (at most once a minute) whether the two tasks exist. Never throws. */
  async checkTasks(force = false) {
    if (!force && Date.now() - this.tasks.at < 60e3) return;
    this.tasks.at = Date.now();
    const exists = async (n) => !(await run('schtasks.exe', ['/query', '/tn', n], { timeout: 10000 })).err;
    const before = this.taskState();
    this.tasks.open = await exists(TASK_OPEN);
    this.tasks.close = await exists(TASK_CLOSE);
    if (this.taskState() !== before) this.emit('change');
  }

  /** Starts one of the tasks. Returns an error text or ''. */
  async runTask(name) {
    const r = await run('schtasks.exe', ['/run', '/tn', name], { timeout: 15000 });
    return r.err ? String(r.stderr || r.stdout || r.err.message).split(/\r?\n/).find((l) => l.trim()) || 'The task did not start' : '';
  }

  /** Runs a PowerShell script as administrator (one Windows prompt) and waits for it. Returns '' or an error text. */
  async runElevatedScript(script) {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    const errFile = path.join(os.tmpdir(), 'iram-task-error.txt');
    try { fs.unlinkSync(errFile); } catch { /* none left over */ }
    const cmd = "$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + b64 + "' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode";
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 120000 });
    if (!r.err) return '';
    if (/canceled|cancelled|1223/i.test(r.stderr + r.err.message)) return 'The administrator prompt was declined';
    let why = '';
    try { why = fs.readFileSync(errFile, 'utf8').split(/\r?\n/).find((l) => l.trim()) || ''; } catch { /* no detail */ }
    return 'The setup failed' + (why ? ': ' + why.trim() : '');
  }

  /** Creates the two tasks (one Windows prompt). Afterwards the executor is opened and closed without any prompt. */
  async setupTasks() {
    if (!this.pathOk()) throw new Error('Pick the executor first');
    const exe = this.cfg().path;
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const e = await this.runElevatedScript(buildTaskScript({ user, exe, name: this.name() }));
    await this.checkTasks(true);
    if (e && !(this.tasks.open && this.tasks.close)) throw new Error(e);
    if (!(this.tasks.open && this.tasks.close)) throw new Error('The tasks were not created');
    this.settings.update({ executor: { taskPath: exe } });
    log.info('administrator tasks for the executor are set up');
    this.emit('change');
  }

  async removeTasks() {
    const e = await this.runElevatedScript(buildTaskRemoveScript());
    await this.checkTasks(true);
    if (this.tasks.open || this.tasks.close) throw new Error(e || 'The tasks could not be removed');
    this.settings.update({ executor: { taskPath: '' } });
    this.emit('change');
  }

  /** Opens the executor with administrator rights: through the task when it is set up, otherwise with the Windows prompt. */
  async elevatedStart(p) {
    if (this.taskReady('open')) {
      const e = await this.runTask(TASK_OPEN);
      if (!e) { log.info('started the executor through its administrator task'); return ''; }
      log.warn('the administrator task did not start (' + e + '); asking Windows instead');
    }
    return this.startAsAdmin(p);
  }

  /** Windows asks for permission each time (the UAC prompt), the same as opening it yourself with Run as administrator. */
  async startAsAdmin(p) {
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(p)} -WorkingDirectory ${q(path.dirname(p))} -Verb RunAs`], { timeout: 60000 });
    if (r.err) return /canceled|cancelled|1223/i.test(r.stderr + r.err.message) ? 'The administrator prompt was declined' : `Could not start it: ${String(r.stderr || r.err.message).split('\n')[0]}`;
    log.info('started the executor as administrator');
    return '';
  }

  startPlain(p) {
    return new Promise((resolve) => {
      let child;
      const wantsAdmin = (e) => e && (['EACCES', 'EPERM', 'UNKNOWN'].includes(e.code) || /740|elevation/i.test(String(e.message)));
      try { child = spawn(p, [], { cwd: path.dirname(p), detached: true, stdio: 'ignore' }); } catch (e) { return resolve(wantsAdmin(e) ? NEEDS_ADMIN : `Could not start it: ${e.message}`); }
      child.once('error', (e) => resolve(wantsAdmin(e) ? NEEDS_ADMIN : `Could not start it: ${e.message}`));
      setTimeout(() => { child.unref(); log.info('started the executor'); resolve(''); }, 600);
    });
  }

  async isRunning() { return (await this.find()).length > 0; }

  /** For an A/B round: closes the executor (politely first) and keeps it closed until release(). Throws when it cannot be closed. */
  async hold() {
    this.held = true;
    const closeAll = async (force) => { for (const p of await this.find()) await run('taskkill.exe', force ? ['/F', '/PID', String(p.pid)] : ['/PID', String(p.pid)], { timeout: 8000 }); };
    await closeAll(false);
    const until = Date.now() + 8000;
    while (Date.now() < until && (await this.find()).length) await sleep(500);
    await closeAll(true);
    let left = await this.find();
    if (left.length) {
      if (this.taskReady('close')) {
        await this.runTask(TASK_CLOSE);
        const until2 = Date.now() + 8000;
        while (Date.now() < until2 && (await this.find()).length) await sleep(500);
        left = await this.find();
      }
    }
    if (left.length) {
      // A program running as administrator cannot be closed by a normal one: ask Windows for permission once.
      const list = left.flatMap((p) => [`'/PID'`, `'${Math.trunc(Number(p.pid))}'`]).join(',');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath taskkill.exe -ArgumentList '/F',${list} -Verb RunAs -WindowStyle Hidden -Wait`], { timeout: 60000 });
      left = await this.find();
    }
    if (left.length) {
      this.held = false;
      this.setView({ status: 'error', msg: 'It could not be closed (it may need administrator permission)', pid: left[0].pid, memMB: left.reduce((a, p) => a + p.memMB, 0) });
      throw new Error(`${this.name()} could not be closed. Close it yourself, or allow the administrator prompt`);
    }
    this.seen = false; // closed on purpose: not a crash, so nothing brings it back until release()
    this.setView({ status: 'held', msg: 'Closed on purpose for an experiment round', pid: 0, memMB: 0 });
  }

  /** Ends hold() and makes sure the executor is running again. Returns an error text or ''. */
  async release() {
    this.held = false;
    if (await this.isRunning()) return '';
    const e = await this.launch();
    await this.tick();
    return e;
  }

  /**
   * Called before every client launch (when "open it before clients launch" is on): makes sure the executor is open, so a
   * client that starts afterwards finds it. Never blocks a launch for long and never throws.
   */
  ensureOpen() {
    const c = this.cfg();
    if (!c.enabled || !c.openBeforeClients || this.held) return Promise.resolve();
    if (this.ensuring) return this.ensuring;
    this.ensuring = (async () => {
      try {
        if (await this.isRunning()) { this.seen = true; return; }
        if (!this.pathOk()) { log.warn('the executor is not open and its location is not known, so clients start without it'); return; }
        const recent = this.relaunches.filter((t) => Date.now() - t < 3600e3);
        if (recent.length >= RELAUNCH_CAP_PER_HOUR) { log.warn('the executor was started too often in the last hour, so it is not started again before this launch'); return; }
        const e = await this.launch();
        if (e) { log.warn('could not open the executor before the launch: ' + e); return; }
        const until = Date.now() + Math.min(120, Math.max(0, Number(c.openWaitSec) || 0)) * 1000;
        while (Date.now() < until) {
          await sleep(this.pollMs);
          if (await this.isRunning()) { this.seen = true; await sleep(this.settleMs); break; }
        }
        await this.tick();
      } catch (e) { log.warn('open before launch: ' + e.message); } finally { this.ensuring = null; }
    })();
    return this.ensuring;
  }

  /** "Open now" on the Clients page. Returns an error text, or '' when it is open or was started. */
  async openNow() {
    if (!this.cfg().enabled) return 'Turn on executor handling in Settings first';
    if (await this.isRunning()) return '';
    if (!this.pathOk()) return 'The executor location is not known yet. Open it once while the manager runs, or enter its location in Settings';
    this.held = false;
    const e = await this.launch();
    await this.tick();
    return e || '';
  }

  /** Programs that are open right now, for the picker in Settings. */
  async running() {
    const r = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeout: 15000 });
    return listPrograms(parseTasklist(r.stdout));
  }

  /** Looks for .exe files in a folder (two levels deep) so the person can pick the executor. Marks the one that is open right now. */
  async scanFolder(dir) {
    const raw = String(dir || '').trim().replace(/^"(.*)"$/, '$1').slice(0, 400);
    if (!raw) throw new Error('Enter a folder first');
    let base = path.resolve(raw);
    let st;
    try { st = fs.statSync(base); } catch { throw new Error('That folder does not exist'); }
    if (st.isFile()) { base = path.dirname(base); st = fs.statSync(base); }
    if (!st.isDirectory()) throw new Error('That is not a folder');
    const files = [];
    let visited = 0;
    const walk = (d, depth) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const en of entries) {
        if (++visited > 600) return;
        const full = path.join(d, en.name);
        if (en.isDirectory()) { if (depth < 2) walk(full, depth + 1); continue; }
        if (!en.isFile() || !/\.exe$/i.test(en.name) || !validName(en.name) || IGNORED_FILES.test(en.name)) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch { continue; }
        // A running program cannot be opened for writing (Windows refuses with a sharing violation, which Node reports as EBUSY or
        // EPERM): that tells which file is the open one. A read-only file is refused the same way, so it is not counted.
        let inUse = false;
        try { fs.closeSync(fs.openSync(full, 'r+')); } catch (e) { inUse = e.code === 'EBUSY' || (e.code === 'EPERM' && (fs.statSync(full).mode & 0o200) !== 0); }
        const prof = profileOf(en.name);
        files.push({ path: full, rel: path.relative(base, full), name: en.name, sizeMB: Math.round(size / 1048576 * 10) / 10, inUse, profile: prof ? prof.label : '' });
      }
    };
    walk(base, 0);
    return files.sort((a, b) => (b.inUse ? 1 : 0) - (a.inUse ? 1 : 0) || (b.profile ? 1 : 0) - (a.profile ? 1 : 0) || b.sizeMB - a.sizeMB).slice(0, 40);
  }

  // ----- command after each client launch -----
  queueHook(inst) {
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.afterLaunch || !String(cfg.afterLaunch.command || '').trim()) return;
    const delay = Math.min(600, Math.max(0, Number(cfg.afterLaunch.delaySec) || 0)) * 1000;
    setTimeout(() => { this.hookQueue = this.hookQueue.then(() => this.runHook(inst)).catch(() => {}); }, delay);
  }

  async runHook(inst) {
    const h = this.cfg().afterLaunch || {};
    const cmd = String(h.command || '').trim().replace(/^"(.*)"$/, '$1');
    if (!cmd) return;
    if (this.launcher && !this.launcher.instances.has(inst.pid)) return; // the client is already gone
    const ext = path.extname(cmd).toLowerCase();
    if (!HOOK_EXT.has(ext) || !fs.existsSync(cmd)) { this.noteHook(false, 'The command must be an existing .exe, .bat, .cmd or .ps1 file'); return; }
    const acc = this.accounts ? this.accounts.get(inst.accountId) : null;
    const pids = this.launcher ? [...this.launcher.instances.keys()].join(',') : String(inst.pid);
    const env = { ...process.env, IRAM_PID: String(inst.pid), IRAM_PIDS: pids, IRAM_EXECUTOR: this.cfg().path || '', IRAM_ACCOUNT: acc ? acc.username : '', IRAM_USERID: acc ? String(acc.userId || '') : '' };
    const args = splitArgs(h.args);
    let file = cmd, full = args;
    if (ext === '.ps1') { file = 'powershell.exe'; full = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cmd, ...args]; }
    else if (ext === '.bat' || ext === '.cmd') { file = 'cmd.exe'; full = ['/d', '/c', 'call', cmd, ...args]; }
    const r = await run(file, full, { env, timeout: HOOK_TIMEOUT_MS, cwd: path.dirname(cmd) });
    this.noteHook(!r.err, r.err ? String(r.err.killed ? 'Timed out' : r.err.message).split('\n')[0] : 'Ran for ' + (acc ? acc.username : 'a client'));
  }

  noteHook(ok, msg) {
    this.hook = { runs: this.hook.runs + 1, lastAt: Date.now(), ok, msg };
    if (!ok) log.warn('after-launch command: ' + msg);
    this.emit('change');
  }

  publicView() {
    const c = this.cfg();
    return {
      enabled: !!c.enabled, name: this.name(), status: this.view.status, msg: this.view.msg, pid: this.view.pid, memMB: this.view.memMB,
      pathKnown: this.pathOk(), elevated: this.looksElevated, adminTask: this.taskState(), profile: (profileOf(this.name()) || {}).label || '', openBeforeClients: !!c.openBeforeClients, hook: { configured: !!(c.afterLaunch && String(c.afterLaunch.command || '').trim()), ...this.hook },
    };
  }
}

module.exports = { Executor, decide, parseTasklist, splitArgs, validName, profileOf, listPrograms, buildTaskScript, buildTaskRemoveScript, TASK_OPEN, TASK_CLOSE, PROFILES, RELAUNCH_CAP_PER_HOUR };
