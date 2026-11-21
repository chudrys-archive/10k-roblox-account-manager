'use strict';
const path = require('path');
const EventEmitter = require('events');
const { DATA, atomicWrite, readJson, logger } = require('./util');

const log = logger('captcha-guard');
const FILE = path.join(DATA, 'captcha-guard.json');
// Launches that happen without the person at the keyboard. These stop while the guard is paused.
// Buttons in the UI and the Launch / Restart actions are the person's own choice and keep working.
const AUTOMATED = new Set(['keep-alive', 'api']);
const BLANK = { paused: false, since: 0, account: '', reason: '', resumeAt: 0 };

/**
 * Captcha guard. When Roblox shows a captcha or verification for any account, automatic activity
 * (keep-alive rejoins, watchdog restarts, server hops, API launches) stops for every account, not
 * just the one that was challenged. Roblox often challenges a burst of rejoins from one network, so
 * stopping everything is what keeps the other accounts from being challenged too. The state is saved
 * to disk: a restart of the manager does not silently resume automation while Roblox still wants a check.
 */
class CaptchaGuard extends EventEmitter {
  constructor({ settings, file = FILE }) {
    super();
    this.settings = settings;
    this.file = file;
    const saved = readJson(file, null) || {};
    this.state = { ...BLANK, ...saved, paused: !!saved.paused };
    this.timer = null;
    if (this.state.paused && this.state.resumeAt && this.state.resumeAt <= Date.now()) this.state = { ...BLANK };
    this.schedule();
  }

  cfg() { return this.settings.get('captchaGuard') || {}; }

  get paused() { return this.state.paused; }

  /** True when a launch with this reason must be refused right now. */
  blocks(reason) { return this.state.paused && AUTOMATED.has(reason); }

  /**
   * A captcha / verification appeared for `account`. Pauses automation when the guard is on and
   * pauseAll is set. Returns true only for the pause that actually started, so one alert is sent.
   */
  trip(account, where) {
    const c = this.cfg();
    if (!c.enabled || !c.pauseAll || this.state.paused) return false;
    this.state = {
      paused: true, since: Date.now(), account: account.username || account.id || '', reason: String(where || ''),
      resumeAt: c.autoResumeMin ? Date.now() + c.autoResumeMin * 60e3 : 0,
    };
    this.save();
    this.schedule();
    log.warn(`captcha guard: automation paused after ${this.state.account} (${this.state.reason})`);
    this.emit('trip', { ...this.state });
    this.emit('change');
    return true;
  }

  /** Lift the pause. Accounts that are still in "needs verification" stay blocked on their own. */
  resume(why = 'manual') {
    if (!this.state.paused) return false;
    clearTimeout(this.timer); this.timer = null;
    this.state = { ...BLANK };
    this.save();
    log.info(`captcha guard: automation resumed (${why})`);
    this.emit('resume', why);
    this.emit('change');
    return true;
  }

  schedule() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.state.paused || !this.state.resumeAt) return;
    const wait = Math.max(0, this.state.resumeAt - Date.now());
    this.timer = setTimeout(() => this.resume('auto-resume timer'), wait);
    if (this.timer.unref) this.timer.unref();
  }

  save() {
    try { atomicWrite(this.file, JSON.stringify(this.state)); } catch (e) { log.warn('could not save guard state: ' + e.message); }
  }

  publicView() {
    const c = this.cfg();
    return { ...this.state, enabled: !!c.enabled, pauseAll: !!c.pauseAll, autoResumeMin: c.autoResumeMin || 0 };
  }

  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { CaptchaGuard, AUTOMATED };
