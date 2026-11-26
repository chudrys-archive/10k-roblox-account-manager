'use strict';

/** Pure: true when a bulk cookie check is due. hours = 0 means the feature is off. */
function validateDue(lastAt, now, hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return false;
  if (!Number.isFinite(lastAt) || !Number.isFinite(now)) return false;
  return now - lastAt >= h * 3600e3;
}

/**
 * The scheduled "re-check every login" job. tick() is cheap and meant to run every few minutes: it starts a bulk validation only
 * when the setting is on and the interval has passed, never while a previous one is still running, and never throws.
 * Dead cookies are reported by the accounts module's own 'invalid' event (which sends the Discord alert).
 * Returns 'off', 'not-due', 'busy', 'empty' or 'started'.
 */
function createCookieChecker({ accounts, settings, log, now = Date.now, startedAt = now() }) {
  let lastAt = startedAt;
  let busy = false;
  return {
    tick() {
      try {
        if (!accounts.loaded || !accounts.list.length) return 'empty';
        const hours = settings.get('validateEveryHours');
        if (!(Number(hours) > 0)) return 'off';
        if (busy) return 'busy';
        if (!validateDue(lastAt, now(), hours)) return 'not-due';
        lastAt = now();
        busy = true;
        log.info('scheduled cookie check: validating ' + accounts.list.length + ' account(s)');
        let p;
        try { p = Promise.resolve(accounts.validateMany()); } catch (e) { p = Promise.reject(e); }
        p
          .catch((e) => log.warn('scheduled cookie check: ' + (e && e.message)))
          .finally(() => { busy = false; });
        return 'started';
      } catch (e) {
        busy = false;
        if (log.debug) log.debug('cookie check: ' + e.message);
        return 'off';
      }
    },
    get lastAt() { return lastAt; },
  };
}

module.exports = { validateDue, createCookieChecker };
