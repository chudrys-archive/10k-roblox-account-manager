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
    this.qrImage = null; // quick login: the QR code as a data URL, only while that login waits
  }

  /** Quick login: the native host hands over the QR code (a data URL). Accepted only while a quick login waits. */
  setQr(src) {
    if (!this.pending || !this.pending.qr) return false;
    if (typeof src !== 'string' || !src.startsWith('data:image/')) return false;
    this.qrImage = src;
    return true;
  }

  qrState() {
    const waiting = !!(this.pending && this.pending.qr);
    return { armed: waiting, src: waiting ? this.qrImage : null };
  }

  /** Called by the native host on every status poll. */
  touch() { this.lastSeen = Date.now(); }

  connected(maxAgeMs = 15000) { return Date.now() - this.lastSeen < maxAgeMs; }

  armed() { return !!this.pending; }

  status() {
    return this.pending ? { armed: true, label: this.pending.label, until: this.pending.until, qr: !!this.pending.qr } : { armed: false };
  }

  /**
   * Called on every native-host read with how many Roblox tabs Chrome has open. Once the login window has been seen,
   * a few reads with no Roblox tab left mean the person closed it by hand, so the wait is cancelled instead of
   * blocking every later login until the timeout.
   */
  noteTabs(count) {
    const p = this.pending;
    if (!p) return false;
    if (count > 0) { p.seen = true; p.gone = 0; return false; }
    if (!p.seen) return false;
    p.gone = (p.gone || 0) + 1;
    if (p.gone < 3) return false;
    this.cancel('window closed');
    return true;
  }

  /** Resolves with the cookie string, or rejects on timeout or cancel. Arming again supersedes the old wait. */
  arm({ timeoutMs = 10 * 60 * 1000, label = '', qr = false } = {}) {
    this.cancel('superseded');
    this.qrImage = null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.timer === timer) this.pending = null;
        reject(new Error('Login timed out. If Chrome was already signed into Roblox, sign out there first and try again.'));
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this.pending = { label, until: Date.now() + timeoutMs, baseline: undefined, resolve, reject, timer, qr: !!qr };
      log.info(`capture armed${label ? ' for ' + label : ''}`);
    });
  }

  cancel(reason = 'cancelled') {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    clearTimeout(p.timer);
    const msg = reason === 'superseded' ? 'Login superseded by another login'
      : reason === 'window closed' ? 'The login window was closed before the account was captured'
      : 'Login cancelled';
    const err = new Error(msg);
    err.windowClosed = reason === 'window closed';
    p.reject(err);
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