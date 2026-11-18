'use strict';
const { logger, sleep } = require('./util');

const log = logger('alerts');
const COLORS = { info: 0x4aa8ff, ok: 0x34d399, warn: 0xfbbf24, error: 0xf87171 };
const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/**
 * Discord webhook alerts. Events: crash, disconnect (kicked/lost connection), sameAccount,
 * invalid (cookie expired), throttled (relaunch limit hit), launchFail.
 * Per-key cooldown + a serial queue that honours Discord's 429 retry_after, so a looping
 * problem can never spam the channel or get the webhook rate-limited.
 */
class Alerts {
  constructor({ settings }) {
    this.settings = settings;
    this.queue = [];
    this.busy = false;
    this.lastSent = new Map();
  }

  static validUrl(u) { return !u || WEBHOOK_RE.test(u); }

  cfg() { return this.settings.get('alerts'); }

  /** type: event name (must be enabled in settings), key: dedupe key (e.g. account id) */
  send(type, title, description, { level = 'warn', key = '', force = false } = {}) {
    const c = this.cfg();
    if (!c.webhook || (!force && !c.events[type])) return;
    const k = `${type}:${key}`;
    const cool = force ? 0 : c.cooldownMin * 60000;
    if (cool && Date.now() - (this.lastSent.get(k) || 0) < cool) return;
    this.lastSent.set(k, Date.now());
    this.queue.push({
      username: 'Account Manager',
      embeds: [{ title: String(title).slice(0, 250), description: String(description || '').slice(0, 3900), color: COLORS[level] || COLORS.info, timestamp: new Date().toISOString() }],
      ...(c.mention && level === 'error' ? { content: c.mention.slice(0, 100) } : {}),
    });
    if (this.queue.length > 30) this.queue.splice(0, this.queue.length - 30);
    this.pump();
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const url = this.cfg().webhook;
        if (!url) { this.queue.length = 0; break; }
        const body = this.queue[0];
        let res;
        try {
          res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        } catch (e) { log.warn('webhook network error: ' + e.message); await sleep(5000); this.queue.shift(); continue; }
        if (res.status === 429) {
          const j = await res.json().catch(() => ({}));
          await sleep(Math.min(60000, (j.retry_after || 2) * 1000));
          continue;
        }
        if (!res.ok) log.warn(`webhook rejected (HTTP ${res.status}) - check the URL`);
        this.queue.shift();
        await sleep(1200);
      }
    } finally { this.busy = false; }
  }

  async test() {
    const c = this.cfg();
    if (!c.webhook) throw new Error('Set a Discord webhook URL first');
    const res = await fetch(c.webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ username: 'Account Manager', embeds: [{ title: 'Test alert', description: 'Alerts are working.', color: COLORS.ok, timestamp: new Date().toISOString() }] }),
    });
    if (!res.ok) throw new Error(`Discord rejected the webhook (HTTP ${res.status})`);
    return true;
  }
}

module.exports = { Alerts };
