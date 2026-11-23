'use strict';
const crypto = require('crypto');
const { logger } = require('./util');
const log = logger('capture');

/**
 * Holds at most one pending login capture. While armed, the next Roblox cookie handed over by the capture
 * extension resolves the wait. Nothing is written to disk here. The caller decides what happens to the
 * cookie (add to the vault, or check and drop) and the reference is cleared as soon as the wait ends.
 */
class CaptureGate {
  constructor() {
    this.token = crypto.randomBytes(24).toString('hex');
    this.pending = null; // { label, until, resolve, reject, timer }
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
        reject(new Error('Login timed out'));
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this.pending = { label, until: Date.now() + timeoutMs, resolve, reject, timer };
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

  /** Takes a cookie only while armed. Returns true if it was taken. */
  offer(cookie) {
    if (!this.pending) return false;
    if (typeof cookie !== 'string' || cookie.length < 20) return false;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    log.info('login capture accepted');
    p.resolve(cookie);
    return true;
  }
}

module.exports = { CaptureGate };