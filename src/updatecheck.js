'use strict';
const path = require('path');
const fs = require('fs');
const { logger } = require('./util');

// Asks GitHub for the newest published release and says so when it is newer than the version this build was made from.
// It only tells; it never downloads or installs anything.
const REPO = 'chudrys-archive/10k-roblox-account-manager';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 20 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const log = logger('update');

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a higher x.y.z than `current`. Anything unreadable is "not newer". */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || null; }
  catch { return null; }
}

class UpdateChecker {
  constructor({ fetchImpl = fetch, current = currentVersion(), now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.timer = null;
    this.info = { current, latest: null, url: null, available: false, checkedAt: 0, error: null };
  }

  start() {
    setTimeout(() => { this.check().catch(() => {}); }, FIRST_CHECK_MS).unref();
    this.timer = setInterval(() => { this.check().catch(() => {}); }, CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); }

  async check() {
    const current = this.info.current;
    try {
      const res = await this.fetch(LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'isa-roblox-account-manager' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const data = await res.json();
      if (!parseVersion(data.tag_name)) throw new Error('the latest release has an unexpected name');
      const available = isNewer(data.tag_name, current);
      this.info = {
        current,
        latest: String(data.tag_name).replace(/^v/, ''),
        url: typeof data.html_url === 'string' ? data.html_url : null,
        available,
        checkedAt: this.now(),
        error: null,
      };
      if (available) log.info(`version ${this.info.latest} is out (this is ${current})`);
    } catch (e) {
      this.info = { ...this.info, checkedAt: this.now(), error: e.message };
      log.debug(`update check failed: ${e.message}`);
    }
    return this.info;
  }

  publicView() { return { ...this.info }; }
}

module.exports = { UpdateChecker, isNewer, parseVersion, LATEST_URL };