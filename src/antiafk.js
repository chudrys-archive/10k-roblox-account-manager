'use strict';
const EventEmitter = require('events');
const { logger } = require('./util');

const log = logger('anti-afk');

/** Virtual-key code for a single printable key (A-Z, 0-9) or F1-F24. */
function keyToVk(key) {
  const k = String(key || '').trim().toUpperCase();
  if (/^[A-Z0-9]$/.test(k)) return k.charCodeAt(0);
  const f = k.match(/^F(\d{1,2})$/);
  if (f && +f[1] >= 1 && +f[1] <= 24) return 0x6f + Number(f[1]);
  return 0;
}

/**
 * Roblox disconnects players after 20 minutes without input. Every `intervalMin` minutes each
 * client gets one real input event (focus -> key/click -> focus restored). To avoid fighting the
 * user it waits until they've stopped typing/moving for `waitUserIdleSec`, but never past
 * interval + 3 min, so a client always gets nudged well before the 20-minute kick.
 */
class AntiAfk extends EventEmitter {
  constructor({ helper, launcher, settings, accounts }) {
    super();
    this.helper = helper;
    this.launcher = launcher;
    this.settings = settings;
    this.accounts = accounts;
    this.last = new Map(); // pid -> ts of last nudge
    this.busy = false;
    this.status = '';
    this.lastRun = 0;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => log.error(e.message)), 10000);
    this.launcher.on('exit', (inst) => this.last.delete(inst.pid));
  }

  cfg() { return this.settings.get('antiAfk'); }

  baseline(inst) { return this.last.get(inst.pid) || inst.startedAt; }

  targets() {
    const c = this.cfg();
    const list = [...this.launcher.instances.values()].filter((i) => {
      if (!i.hwnd) return false;
      const acc = this.accounts.get(i.accountId);
      return !acc || acc.fields.antiAfk !== 'off';
    });
    if (c.includeUntracked) {
      for (const u of this.launcher.unknown) if (u.hwnd) list.push({ pid: u.pid, hwnd: u.hwnd, startedAt: Date.now() - 1e9, untracked: true });
    }
    return list;
  }

  nextDue() {
    const c = this.cfg();
    if (!c.enabled) return null;
    const t = this.targets();
    if (!t.length) return null;
    return Math.min(...t.map((i) => this.baseline(i) + c.intervalMin * 60000));
  }

  async tick(force = false) {
    const c = this.cfg();
    if ((!c.enabled && !force) || this.busy) return 0;
    const now = Date.now();
    const interval = c.intervalMin * 60000;
    const all = this.targets();
    const dueNow = all.filter((i) => now - this.baseline(i) >= interval);
    if (!force && !dueNow.length) { this.setStatus(''); return 0; }
    // batch: anything due within the next 2 minutes goes in the same round (one focus pass, not several)
    const due = force ? all : all.filter((i) => now - this.baseline(i) >= interval - 120000);
    if (!due.length) return 0;

    if (!force) {
      const idle = await this.helper.call('idle').catch(() => 1e9);
      const overdue = dueNow.some((i) => now - this.baseline(i) >= interval + 3 * 60000);
      if (idle < c.waitUserIdleSec * 1000 && !overdue) {
        this.setStatus(`${due.length} due - waiting for you to pause input`);
        return 0;
      }
    }

    this.busy = true;
    try {
      const hwnds = due.map((i) => i.hwnd);
      const n = await this.helper.call('nudge', { hwnds, action: c.action, vk: keyToVk(c.key) }, 60000);
      const t = Date.now();
      for (const i of due) {
        this.last.set(i.pid, t);
        const inst = this.launcher.instances.get(i.pid);
        if (inst) inst.lastAfkAt = t;
      }
      this.lastRun = t;
      this.setStatus('');
      log.info(`nudged ${n}/${due.length} client(s) (${c.action})`);
      this.launcher.emit('change');
      return n;
    } finally { this.busy = false; }
  }

  setStatus(s) { if (s !== this.status) { this.status = s; this.emit('change'); } }

  publicView() {
    const c = this.cfg();
    const per = {};
    for (const i of this.targets()) per[i.pid] = { last: this.last.get(i.pid) || null, next: this.baseline(i) + c.intervalMin * 60000 };
    return { enabled: c.enabled, status: this.status, nextDue: this.nextDue(), lastRun: this.lastRun, per };
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { AntiAfk, keyToVk };
