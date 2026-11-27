'use strict';
const EventEmitter = require('events');
const { api } = require('./roblox');
const path = require('path');
const { DATA, logger, atomicWrite, readJson } = require('./util');
const { SAME_ACCOUNT } = require('./logwatch');

const log = logger('watchdog');
const VERIFY_PAUSE_MS = 30 * 60e3;   // after Roblox asks for verification, wait this long before trying again
const MAX_REJOIN_DELAY_MS = 10 * 60e3;
const RESUME_FILE = path.join(DATA, 'keepalive-resume.json');
const RESUME_MAX_AGE_MS = 12 * 3600e3;   // a resume list older than this is ignored: the PC was off for a long time on purpose
const RESUME_GRACE_MS = 20e3;            // after the manager starts: let running clients be adopted and Windows settle before anything is launched
const RESUME_REFRESH_MS = 10 * 60e3;
const RESUME_MAX_ACCOUNTS = 200;

/**
 * Which keep-alive accounts to bring back after the manager (or the whole PC) restarted while they were running.
 * saved = { at, accounts: [id] } as written by the watchdog; accounts that were closed on purpose are never in it.
 * Returns [{ id, at }]: the time each one may start. They are spread by the launch delay plus a random few seconds, so a
 * whole fleet does not sign in at once (a sign-in burst is what Roblox answers with a verification).
 */
function planResume({ saved, accounts, now = Date.now(), launchDelayMs = 6000, rand = Math.random, maxAgeMs = RESUME_MAX_AGE_MS }) {
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.accounts) || !Number.isFinite(saved.at)) return [];
  if (saved.at > now + 60e3 || now - saved.at > maxAgeMs) return [];
  const byId = new Map((accounts || []).map((a) => [a.id, a]));
  const out = [];
  const seen = new Set();
  let t = now + RESUME_GRACE_MS;
  for (const id of saved.accounts.slice(0, RESUME_MAX_ACCOUNTS)) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (!a || !a.keepAlive || !a.keepAlive.enabled || !a.keepAlive.target) continue;
    if (a.status === 'banned' || a.status === 'invalid' || a.status === 'verify') continue;
    out.push({ id, at: t });
    t += Math.max(0, launchDelayMs) + Math.round(rand() * 5000);
  }
  return out;
}

/**
 * How long to wait before rejoining. Every relaunch asks Roblox for a new sign-in ticket and joins
 * a game, and rapid repeats are what make Roblox ask for verification. So the first rejoin is quick,
 * and each further one within 30 minutes waits twice as long (up to 10 minutes). The random spread
 * keeps several accounts from rejoining in lockstep.
 */
function rejoinDelay(s, w, now = Date.now(), rand = Math.random) {
  const recent = s.launches.filter((t) => now - t < 30 * 60e3).length;
  const base = Math.max(5, w.relaunchDelaySec) * 1000;
  const delay = Math.min(MAX_REJOIN_DELAY_MS, base * 2 ** Math.max(0, recent - 1));
  return Math.round(delay * (0.85 + rand() * 0.4));
}

const BURST_WINDOW_MS = 60e3;   // exits this close together count as one burst
const BURST_SIZE = 3;
const BURST_SPREAD_MS = 90e3;   // a burst's relaunches are spread over this much extra time

/**
 * Roblox tears every waiting client down together when one client closes, so several accounts exit in
 * the same few seconds and would all relaunch in the same few seconds: a sign-in burst. During a burst,
 * each relaunch gets a random extra delay so they don't land on Roblox at once. Returns the updated
 * exit times and the extra delay for this exit (0 outside a burst).
 */
function exitBurst(times, now = Date.now(), rand = Math.random) {
  const recent = times.filter((t) => now - t < BURST_WINDOW_MS);
  recent.push(now);
  const burst = recent.length >= BURST_SIZE;
  return { times: recent, extraMs: burst ? Math.round(rand() * BURST_SPREAD_MS) : 0 };
}

const PRESENCE = { 0: 'Offline', 1: 'Online (not in game)', 2: 'In game', 3: 'In Studio', 4: 'Invisible' };

/**
 * Keep-alive: for every account with keepAlive.enabled, make sure a client is running AND actually
 * in a game. Detects: crashed/closed client, hung window, kicked/disconnected (presence says not
 * in game while the process still lives), and optionally does scheduled restarts.
 * Failures back off exponentially; relaunches are capped per hour so a broken game can't loop forever.
 */
class Watchdog extends EventEmitter {
  constructor({ launcher, accounts, settings, logwatch, alerts, guard = null, resumeFile = RESUME_FILE }) {
    super();
    this.resumeFile = resumeFile;
    this.resumeOn = false;      // only the running manager (start()) resumes and records; unit tests drive tick() directly
    this.resumePlanned = false;
    this.resumeSaved = '';
    this.resumeSavedAt = 0;
    this.stopped = false;
    this.launcher = launcher;
    this.accounts = accounts;
    this.settings = settings;
    this.logwatch = logwatch;
    this.alerts = alerts || { send() {} };
    this.guard = guard; // CaptchaGuard: while paused, nothing is relaunched or restarted automatically
    this.state = new Map();
    this.timer = null;
  }

  st(id) {
    let s = this.state.get(id);
    if (!s) {
      s = { status: 'off', msg: '', failures: 0, nextAttemptAt: 0, launches: [], badChecks: 0, lastPresence: null, lastPresenceAt: 0, jobMisses: 0, presenceBusy: false, drops: [], armed: false };
      this.state.set(id, s);
    }
    return s;
  }

  /** Timeline entry for the account's History (see history.js). Emitted as 'event' (acc, kind, msg). */
  note(acc, kind, msg) { this.emit('event', acc, kind, msg); }

  /**
   * Rejoin budget. Every kick or disconnect restart counts. When `breakerDisconnects` of them fall
   * inside `breakerWindowMin`, keep-alive is switched off for that account: rejoining again and
   * again is what gets accounts asked to verify. Returns true when the budget is spent.
   */
  recordDrop(acc, s, now = Date.now()) {
    const w = this.settings.get('watchdog');
    if (!w.breakerDisconnects) return false;
    const windowMs = (w.breakerWindowMin || 60) * 60e3;
    s.drops = (s.drops || []).filter((t) => now - t < windowMs);
    s.drops.push(now);
    if (s.drops.length < w.breakerDisconnects) return false;
    acc.keepAlive.enabled = false;
    s.drops = [];
    s.issue = `paused: ${w.breakerDisconnects} disconnects in ${w.breakerWindowMin} min, keep-alive stopped to avoid a verification`;
    this.setStatus(s, 'off', s.issue);
    if (this.accounts.save) this.accounts.save();
    log.warn(`${acc.username}: ${s.issue}`);
    this.alerts.send('throttled', `${acc.username}: keep-alive stopped`, `It disconnected ${w.breakerDisconnects} times within ${w.breakerWindowMin} minutes, so keep-alive was turned off to stop rejoin attempts. Check the account's History, then turn keep-alive back on when it is safe.`, { level: 'error', key: acc.id });
    this.note(acc, 'breaker', s.issue);
    return true;
  }

  start() {
    this.resumeOn = true;
    const loop = async () => {
      try { await this.tick(); } catch (e) { log.error('tick: ' + e.message); }
      this.timer = setTimeout(loop, this.settings.get('watchdog').tickSec * 1000);
    };
    this.timer = setTimeout(loop, 3000);
    if (this.logwatch) {
      // Identity check: a client must be signed in as the account it was launched for. If Roblox
      // ever puts a different account in it (e.g. shared client state), close it at once - leaving
      // it running would mean two of your accounts acting as one.
      this.logwatch.on('identity', (inst, ls) => {
        const acc = this.accounts.get(inst.accountId);
        if (!acc) return;
        if (ls.userId === acc.userId) { inst.verified = true; return; }
        inst.verified = false;
        const other = this.accounts.list.find((a) => a.userId === ls.userId);
        const who = other ? other.username : `user ${ls.userId}`;
        log.error(`IDENTITY MISMATCH: client pid ${inst.pid} was launched for ${acc.username} but is signed in as ${who} - closing it`);
        this.note(acc, 'identity', `Client was signed in as ${who}. It was closed and keep-alive paused.`);
        this.alerts.send('sameAccount', `Account mix-up prevented`, `A client launched for **${acc.username}** was signed in as **${who}**. It was closed and keep-alive for ${acc.username} was paused. Re-validate the account before relaunching.`, { level: 'error', key: acc.id, force: true });
        if (acc.keepAlive.enabled) { acc.keepAlive.enabled = false; this.accounts.save(); }
        const s = this.st(acc.id);
        s.issue = `paused: client was signed in as ${who}`;
        this.setStatus(s, 'off', s.issue);
        this.launcher.kill([inst.pid], 'identity mismatch').catch(() => {});
      });
      // exact server tracking from the client's own log (faster and more reliable than presence)
      this.logwatch.on('join', (inst, ls) => {
        const acc = this.accounts.get(inst.accountId);
        const t = acc && acc.keepAlive.enabled && acc.keepAlive.target;
        if (!t || t.type !== 'job') return;
        const s = this.st(acc.id);
        s.jobMisses = ls.jobId === t.jobId ? 0 : s.jobMisses + 1;
      });
    }
    this.launcher.on('exit', (inst) => {
      const acc = this.accounts.get(inst.accountId);
      const byHand = !inst.killReason && inst.exitCode === 0; // clean exit: the window was closed by hand
      if (acc && acc.keepAlive.enabled && !inst.killReason && !byHand) {
        this.alerts.send('crash', `${acc.username}: client closed`, 'The Roblox client exited unexpectedly (crash or closed window). Keep-alive is relaunching it.', { key: acc.id });
      }
      // exits the person did not ask for count toward a burst; a restart we did ourselves does not
      let extraMs = 0;
      if (!inst.killReason && !byHand) {
        const b = exitBurst(this.exitTimes || []);
        this.exitTimes = b.times;
        extraMs = b.extraMs;
      }
      if (!acc || !acc.keepAlive.enabled) return;
      const s = this.st(inst.accountId);
      const w = this.settings.get('watchdog');
      if (!s.nextAttemptAt || s.nextAttemptAt < Date.now()) s.nextAttemptAt = Date.now() + rejoinDelay(s, w) + extraMs;
      s.msg = `client ${byHand ? 'closed by hand' : 'exited'}${inst.killReason ? ` (${inst.killReason})` : ''}; relaunching`;
    });
  }

  setStatus(s, status, msg) {
    if (s.status !== status || (msg !== undefined && s.msg !== msg)) {
      s.status = status;
      if (msg !== undefined) s.msg = msg;
      this.emit('change');
    }
  }

  async tick() {
    if (!this.accounts.loaded || this.stopped) return;
    if (this.resumeOn && !this.resumePlanned) this.applyResume();
    const w = this.settings.get('watchdog');
    const now = Date.now();
    for (const acc of this.accounts.list) {
      const ka = acc.keepAlive;
      const s = this.st(acc.id);
      if (!ka.enabled || !ka.target) {
        // keep the reason if keep-alive paused itself (wrong account / signed in elsewhere) so the user sees why
        if (s.status !== 'off') this.setStatus(s, 'off', s.issue || '');
        s.failures = 0; s.nextAttemptAt = 0; s.armed = false;
        continue;
      }
      if (s.issue) { s.issue = ''; s.msg = ''; } // user turned it back on
      if (!w.enabled) { this.setStatus(s, 'paused', 'Watchdog paused globally'); continue; }
      if (this.guard && this.guard.paused) {
        // Captcha guard: no rejoins, restarts or hops for any account until the person resumes.
        this.setStatus(s, 'paused', 'Captcha guard: automation paused');
        continue;
      }
      if (acc.status === 'verify') { this.setStatus(s, 'error', 'needs verification'); continue; }
      if (acc.status === 'invalid' || acc.status === 'banned') { this.setStatus(s, 'error', acc.statusMsg || 'account unusable'); continue; }
      if (this.launcher.pending.has(acc.id)) { s.armed = true; this.setStatus(s, 'launching'); continue; }
      if (this.launcher.isHeld?.(acc.id) && !this.launcher.byAccount(acc.id).length) { s.armed = false; this.setStatus(s, 'stopped', 'closed on purpose - keep-alive will not relaunch it until you launch it'); continue; }

      const inst = this.launcher.byAccount(acc.id)[0];
      if (inst) {
        s.armed = true; // a client of this account is open: from now on, losing it means relaunching it
        if (s.resumed) { s.resumed = false; s.nextAttemptAt = 0; s.msg = ''; } // it was still open (or came back by itself): nothing to resume
        this.setStatus(s, 'running', s.lastPresence ? PRESENCE[s.lastPresence.userPresenceType] : 'started');
        if (w.killHungAfterSec && inst.hungSince && now - inst.hungSince > w.killHungAfterSec * 1000) {
          log.warn(`${acc.username}: window not responding for ${w.killHungAfterSec}s, restarting`);
          await this.restart(acc, inst, 'hung');
          continue;
        }
        // Fast path: the client's log says it was disconnected and it never rejoined (teleports rejoin within seconds)
        const ls = inst.logState;
        if (ls && !ls.inGame && ls.disconnectedAt && now - ls.disconnectedAt > w.disconnectGraceSec * 1000) {
          if (ls.rejoinLoop) {
            // The client kept retrying the join and Roblox kept refusing it (usually a moderated account). Restarting
            // would only repeat that, so close the dead client, turn keep-alive off and re-check the account.
            log.warn(`${acc.username}: joins are being rejected (${ls.reason}) - closing the client and pausing keep-alive`);
            this.alerts.send('disconnect', `${acc.username}: cannot rejoin`, `Roblox keeps rejecting this account's join (${ls.reason}). The client was closed and keep-alive turned off. Validate the account to see if it is moderated.`, { level: 'error', key: acc.id });
            acc.keepAlive.enabled = false;
            this.accounts.save();
            s.issue = `paused: ${ls.reason}`;
            this.setStatus(s, 'off', s.issue);
            this.note(acc, 'breaker', 'Joins rejected repeatedly. Client closed, keep-alive turned off.');
            ls.disconnectedAt = 0;
            await this.launcher.kill([inst.pid], 'joins rejected');
            this.accounts.validate(acc).catch((e) => log.warn(`${acc.username}: re-check failed: ${e.message}`));
            continue;
          }
          if (SAME_ACCOUNT.has(ls.code)) {
            log.warn(`${acc.username}: account was launched somewhere else (code ${ls.code}) - pausing keep-alive to avoid fighting over the session`);
            this.alerts.send('sameAccount', `${acc.username}: signed in elsewhere`, `Roblox disconnected this client because the same account joined a game from another device/client (code ${ls.code}). Keep-alive was turned off for this account.`, { level: 'error', key: acc.id });
            acc.keepAlive.enabled = false;
            this.accounts.save();
            s.issue = `paused: ${ls.reason}`;
            this.setStatus(s, 'off', s.issue);
            this.note(acc, 'breaker', `Signed in elsewhere (code ${ls.code}). Keep-alive turned off.`);
            ls.disconnectedAt = 0;
            continue;
          }
          log.warn(`${acc.username}: disconnected (${ls.reason}) and did not rejoin - restarting`);
          this.alerts.send('disconnect', `${acc.username}: disconnected`, `Reason: **${ls.reason}**${ls.code ? ` (code ${ls.code})` : ''}. Restarting the client.`, { key: acc.id });
          if (this.recordDrop(acc, s)) { ls.disconnectedAt = 0; await this.launcher.kill([inst.pid], 'rejoin budget reached'); continue; }
          if (acc.keepAlive.target && acc.keepAlive.target.type === 'job') s.jobMisses++;
          await this.restart(acc, inst, `disconnected: ${ls.reason}`);
          continue;
        }
        // Stalled: the client is alive but has not joined any server for too long (stuck loading, frozen after a kick with nothing in its log).
        // Only judged when the client's log is matched, and counted against the same rejoin budget as a kick.
        if (w.noJoinRestartMin && ls) {
          const lastJoin = ls.joinedAt || inst.startedAt;
          if (lastJoin && now - lastJoin > w.noJoinRestartMin * 60e3) {
            const mins = Math.round((now - lastJoin) / 60e3);
            log.warn(`${acc.username}: no server joined for ${mins} min - restarting`);
            this.alerts.send('disconnect', `${acc.username}: stalled`, `The client has not joined a server for ${mins} minutes. Restarting it.`, { key: acc.id });
            if (this.recordDrop(acc, s)) { await this.launcher.kill([inst.pid], 'rejoin budget reached'); continue; }
            await this.restart(acc, inst, `no server joined for ${mins} min`);
            continue;
          }
        }
        if (w.restartEveryMin && !(acc.main && this.settings.get('closeAllKeepsMain') !== false) && now - inst.startedAt > w.restartEveryMin * 60000) {
          log.info(`${acc.username}: scheduled restart`);
          await this.restart(acc, inst, 'scheduled restart');
          continue;
        }
        // Presence is the fallback (log unavailable, or stuck without any log signal). When the log
        // confirms the client is in a server we check far less often to save API calls.
        const presenceEvery = (ls && ls.inGame ? 4 : 1) * w.presenceIntervalSec * 1000;
        if (w.presenceCheck && now - inst.startedAt > w.graceSec * 1000 && now - s.lastPresenceAt > presenceEvery && !s.presenceBusy) {
          this.checkPresence(acc, inst, s).catch((e) => log.debug('presence: ' + e.message));
        }
        continue;
      }

      // Not running. Keep-alive only brings back a client it has seen running (crash, closed window, kick). Turning keep-alive on
      // for an account that is not open does not start it, unless the person allowed that in Settings.
      if (!s.armed && !w.startOnEnable) {
        s.failures = 0; s.nextAttemptAt = 0;
        this.setStatus(s, 'idle', 'Standby: keep-alive relaunches this account only after a client that was open closes. Launch it yourself to start.');
        continue;
      }
      if (s.nextAttemptAt && now < s.nextAttemptAt) {
        this.setStatus(s, 'waiting', `${s.msg ? s.msg + ' - ' : ''}retry in ${Math.ceil((s.nextAttemptAt - now) / 1000)}s`);
        continue;
      }
      s.launches = s.launches.filter((t) => now - t < 3600e3);
      if (s.launches.length >= w.maxRelaunchesPerHour) {
        s.nextAttemptAt = s.launches[0] + 3600e3;
        this.setStatus(s, 'throttled', `hit ${w.maxRelaunchesPerHour} launches/hour`);
        log.warn(`${acc.username}: relaunch limit reached, pausing until ${new Date(s.nextAttemptAt).toLocaleTimeString()}`);
        this.alerts.send('throttled', `${acc.username}: relaunch limit reached`, `Relaunched ${w.maxRelaunchesPerHour} times in the last hour - something keeps failing (game down, banned from the experience, bad server?). Paused until ${new Date(s.nextAttemptAt).toLocaleTimeString()}.`, { level: 'error', key: acc.id });
        continue;
      }
      s.launches.push(now);
      s.badChecks = 0;
      const target = this.pickTarget(acc, s, w);
      this.setStatus(s, 'launching', `-> ${target.label || target.type}`);
      this.launcher.launch(acc.id, target, 'keep-alive').then(() => {
        s.failures = 0; s.nextAttemptAt = 0; s.msg = '';
      }, (e) => {
        if (e && e.guardPaused) {
          // refused by the captcha guard, not a failed launch: no backoff, no alert
          s.nextAttemptAt = 0; s.launches.pop();
          this.setStatus(s, 'paused', e.outsideWindow ? 'Outside the run window' : 'Captcha guard: automation paused');
          return;
        }
        if (e && e.commitShort) {
          // Windows has no commit headroom for another client yet. Try again in a minute; not a failure, no alert.
          s.nextAttemptAt = Date.now() + 60e3; s.launches.pop();
          s.msg = 'waiting for free memory';
          this.setStatus(s, 'waiting', s.msg);
          return;
        }
        if (e && e.verification) {
          // Don't keep asking: every attempt makes Roblox more suspicious. The person completes it.
          s.nextAttemptAt = Date.now() + VERIFY_PAUSE_MS;
          s.msg = 'Roblox wants verification: open this account in the browser (Open browser), complete the check, then keep-alive resumes';
          log.warn(`${acc.username}: Roblox asked for verification; keep-alive retries in 30 min`);
          this.alerts.send('launchFail', `${acc.username}: verification needed`, 'Roblox asked this account to verify before joining. Open it in the browser from the manager, complete the check, and keep-alive will resume (it retries every 30 minutes on its own).', { level: 'error', key: acc.id });
          this.setStatus(s, 'error', s.msg);
          return;
        }
        s.failures++;
        const delay = Math.min(15 * 60e3, w.relaunchDelaySec * 1000 * 2 ** s.failures);
        s.nextAttemptAt = Date.now() + delay;
        s.msg = `launch failed: ${e.message}`;
        log.error(`${acc.username}: ${e.message} (retry in ${Math.round(delay / 1000)}s)`);
        this.alerts.send('launchFail', `${acc.username}: launch failed`, `${e.message}\nRetrying in ${Math.round(delay / 1000)}s.`, { key: acc.id });
        this.emit('change');
      });
    }
    if (this.resumeOn) this.saveResume();
  }

  /**
   * After a restart of the manager or the PC: read the list of keep-alive accounts that were running and schedule each one to start, one
   * at a time. Runs once, on the first tick. Accounts closed on purpose were taken off the list when they were stopped.
   */
  applyResume(now = Date.now(), rand = Math.random) {
    this.resumePlanned = true;
    const w = this.settings.get('watchdog');
    if (w.resumeAfterRestart === false) return [];
    let saved = null;
    try { saved = readJson(this.resumeFile, null); } catch { saved = null; }
    const launchDelayMs = (Number(this.settings.get('launchDelaySec')) || 6) * 1000;
    const plan = planResume({ saved, accounts: this.accounts.list, now, launchDelayMs, rand });
    let n = 0;
    for (const p of plan) {
      if (this.launcher.byAccount(p.id).length || this.launcher.pending.has(p.id)) continue;
      const s = this.st(p.id);
      s.armed = true; s.resumed = true; s.nextAttemptAt = p.at; s.msg = 'resuming after a restart';
      const acc = this.accounts.get(p.id);
      if (acc) this.note(acc, 'resume', 'The manager restarted while this account was running. Bringing it back.');
      n++;
    }
    if (n) log.info(`resuming ${n} keep-alive account(s) after a restart, one at a time`);
    return plan;
  }

  /** Remember which keep-alive accounts are running (armed), so a restart of the PC or the manager can bring them back. */
  saveResume(now = Date.now()) {
    if (this.stopped) return;
    const ids = (this.accounts.list || []).filter((a) => a.keepAlive && a.keepAlive.enabled && this.st(a.id).armed).map((a) => a.id);
    const key = JSON.stringify(ids);
    if (key === this.resumeSaved && now - this.resumeSavedAt < RESUME_REFRESH_MS) return;
    this.resumeSaved = key; this.resumeSavedAt = now;
    try { atomicWrite(this.resumeFile, JSON.stringify({ at: now, accounts: ids })); } catch (e) { log.warn('could not save the resume list: ' + e.message); }
  }

  pickTarget(acc, s, w) {
    const t = acc.keepAlive.target;
    if (t.type === 'job' && w.fallbackToPublic && s.jobMisses >= 2) {
      log.info(`${acc.username}: JobId ${t.jobId.slice(0, 8)} unreachable twice, joining any server`);
      return { type: 'game', placeId: t.placeId, label: `${t.placeId} (fallback)` };
    }
    return t;
  }

  async restart(acc, inst, reason) {
    const s = this.st(acc.id);
    s.badChecks = 0;
    s.nextAttemptAt = Date.now() + rejoinDelay(s, this.settings.get('watchdog'));
    s.msg = reason;
    this.note(acc, 'restart', reason);
    await this.launcher.kill([inst.pid], reason);
  }

  /**
   * The screen check saw a stuck client: kind is 'frozen' (the picture stopped changing), 'dialog' (an error dialog is showing) or
   * 'moderation' (a ban/termination message: reported, never relaunched). Restarts count against the same rejoin budget as a kick.
   */
  async screenIssue(acc, inst, kind, detail = '') {
    const s = this.st(acc.id);
    if (!acc.keepAlive.enabled || !this.launcher.instances.has(inst.pid)) return;
    if (this.guard && this.guard.paused) return;
    if (kind === 'moderation') {
      if (s.screenModeration === inst.pid) return;
      s.screenModeration = inst.pid;
      log.warn(`${acc.username}: the window shows a moderation message - not relaunching`);
      this.alerts.send('disconnect', `${acc.username}: moderation message`, `The client window shows: ${detail}. It was left open. Check the account.`, { level: 'error', key: acc.id });
      this.note(acc, 'screen', `Moderation message on screen: ${detail}`);
      return;
    }
    const reason = kind === 'frozen' ? `screen frozen for ${detail}` : `error dialog on screen: ${detail}`;
    log.warn(`${acc.username}: ${reason} - restarting`);
    this.alerts.send('disconnect', `${acc.username}: ${kind === 'frozen' ? 'frozen' : 'error dialog'}`, `${reason}. Restarting the client.`, { key: acc.id });
    if (this.recordDrop(acc, s)) { await this.launcher.kill([inst.pid], 'rejoin budget reached'); return; }
    await this.restart(acc, inst, reason);
  }

  async checkPresence(acc, inst, s) {
    s.presenceBusy = true;
    try {
      const [p] = await api.getPresence(this.accounts.session(acc), [acc.userId]);
      s.lastPresenceAt = Date.now();
      if (!p) return;
      s.lastPresence = { userPresenceType: p.userPresenceType, placeId: p.placeId, gameId: p.gameId, lastLocation: p.lastLocation };
      const w = this.settings.get('watchdog');
      const t = acc.keepAlive.target;
      if (p.userPresenceType === 2) {
        s.badChecks = 0;
        if (t && t.type === 'job') s.jobMisses = p.gameId && p.gameId.toLowerCase() !== t.jobId ? s.jobMisses + 1 : 0;
        this.setStatus(s, 'running', `In game${p.lastLocation ? ': ' + p.lastLocation : ''}`);
      } else if (p.userPresenceType === 0 || p.userPresenceType === 1) {
        s.badChecks++;
        this.setStatus(s, 'running', `${PRESENCE[p.userPresenceType]} (${s.badChecks}/${w.badChecksToRestart})`);
        if (s.badChecks >= w.badChecksToRestart && this.launcher.instances.has(inst.pid)) {
          log.warn(`${acc.username}: client alive but not in a game (kicked/disconnected?) - restarting`);
          if (this.recordDrop(acc, s)) { s.badChecks = 0; await this.launcher.kill([inst.pid], 'rejoin budget reached'); return; }
          if (t && t.type === 'job') s.jobMisses++;
          await this.restart(acc, inst, 'disconnected/kicked');
        }
      }
      // 3 (Studio) / 4 (Invisible): can't judge, leave it alone
    } finally { s.presenceBusy = false; }
  }

  publicView() {
    const out = {};
    for (const [id, s] of this.state) out[id] = { status: s.status, msg: s.msg, failures: s.failures, nextAttemptAt: s.nextAttemptAt, launchesLastHour: s.launches.filter((t) => Date.now() - t < 3600e3).length, presence: s.lastPresence };
    return out;
  }

  /** clearResume: the clients are being closed on purpose with the manager, so the next start must not bring them back. */
  stop({ clearResume = false } = {}) {
    this.stopped = true;
    clearTimeout(this.timer);
    if (clearResume && this.resumeOn) { try { atomicWrite(this.resumeFile, JSON.stringify({ at: Date.now(), accounts: [] })); } catch {} }
  }
}

module.exports = { Watchdog, rejoinDelay, exitBurst, planResume };
