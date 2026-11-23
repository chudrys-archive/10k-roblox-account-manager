'use strict';
const crypto = require('crypto');
const { logger } = require('./util');
const log = logger('capture');

/**
 * Holds at most one pending login capture. While armed, the extension reads the Roblox cookie and hands it over.
 * The first reading after arming is the browser's starting state (maybe already signed in) and is never taken, so
 * an account that was already signed in can't be grabbed by accident. After that, only a cookie that is new is taken.
 * Nothing is written to disk here. The caller decides what happens to the cookie.
 */
class CaptureGate {
  constructor() {
    this.token = crypto.randomBytes(24).toString('hex');
    this.pending = null; // { label, until, baseline, resolve, reject, timer }
    this.lastSeen = 0;   // last time the native host asked for status
  }

  /** Called by the native host on every status poll. */
  touch() { this.lastSeen = Date.now(); }

  connected(maxAgeMs = 15000) { return Date.now() - this.lastSeen < maxAgeMs; }

  armed() { return !!this.pending; }

  status() {
    return this.pending ? { armed: true, label: this.pending.label, until: this.pending.until } : { armed: false };
  }

  /** Resolves with the cookie string, or rejects on timeout or cancel. Arming again supersedes the old wait. */
  arm({ timeoutMs = 10 * 60 * 1000, label = '' } = {}) {
    this.cancel('superseded');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.timer === timer) this.pending = null;
        reject(new Error('Login timed out. If Chrome was already signed into Roblox, sign out there first and try again.'));
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this.pending = { label, until: Date.now() + timeoutMs, baseline: undefined, resolve, reject, timer };
      log.info(`capture armed${label ? ' for ' + label : ''}`);
    });
  }

  cancel(reason = 'cancelled') {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(new Error(reason === 'superseded' ? 'Login superseded by another login' : 'Login cancelled'));
    return true;
  }

  /**
   * Called with the cookie the extension read (or null). Returns true only when a new cookie was taken.
   */
  offer(cookie) {
    const p = this.pending;
    if (!p) return false;
    const value = typeof cookie === 'string' && cookie.length >= 20 ? cookie : null;
    if (p.baseline === undefined) { p.baseline = value; return false; }
    if (!value || value === p.baseline) return false;
    this.pending = null;
    clearTimeout(p.timer);
    log.info('login capture accepted');
    p.resolve(value);
    return true;
  }
}

module.exports = { CaptureGate };