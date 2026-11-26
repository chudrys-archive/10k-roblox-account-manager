'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-close-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher, closeGapMs, CLOSE_GAP_MIN_MS, CLOSE_GAP_MAX_MS } = require('../src/launcher');
const { DEFAULTS } = require('../src/settings');

function setup(n) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const list = Array.from({ length: n }, (_, i) => ({ id: `acc${i}`, userId: 1000 + i, username: `alt${i}`, alias: '', group: 'Default', status: 'valid', fields: {}, keepAlive: { enabled: false } }));
  const accounts = new EventEmitter();
  Object.assign(accounts, { list, loaded: true, get: (id) => list.find((a) => a.id === id) || null, displayName: (a) => a.username, save() {}, session: () => ({}) });
  let procs = [];
  const calls = [];
  const helper = {
    procs: async () => procs,
    call: async (cmd, a) => { if (cmd === 'kill') { calls.push(a.pids.slice()); procs = procs.filter((p) => !a.pids.includes(p.pid)); return a.pids.length; } return 0; },
  };
  const launcher = new Launcher({ helper, settings, accounts });
  const start = new Date().toISOString();
  procs = list.map((a, i) => ({ pid: 100 + i, btid: `T${i}`, hwnd: 1000 + i, title: '', memMB: 100, hung: false, start }));
  list.forEach((a, i) => launcher.btids.set(`T${i}`, { accountId: a.id, at: Date.now() }));
  return { launcher, calls };
}

test('closeGapMs stays within 10-15 seconds', () => {
  assert.equal(closeGapMs(() => 0), CLOSE_GAP_MIN_MS);
  assert.equal(closeGapMs(() => 0.999999), CLOSE_GAP_MAX_MS);
  for (let i = 0; i < 200; i++) { const g = closeGapMs(); assert.ok(g >= 10000 && g <= 15000); }
});

test('close all closes one client at a time with a pause between them', async () => {
  const { launcher, calls } = setup(4);
  await launcher.sync();
  assert.equal(launcher.instances.size, 4);
  const gaps = [];
  const r = launcher.closeAllStaggered(true, { gapMs: () => 12000, sleepFn: async (ms) => { gaps.push(ms); } });
  assert.equal(r.queued, 4);
  await r.done;
  assert.equal(calls.length, 4, 'one kill per client');
  assert.ok(calls.every((c) => c.length === 1), 'never more than one process per kill');
  assert.deepEqual(gaps, [12000, 12000, 12000], 'a pause before every client except the first');
  assert.equal(launcher.instances.size, 0);
});

test('a second close all while one is running does nothing', async () => {
  const { launcher, calls } = setup(3);
  await launcher.sync();
  let release;
  const gate = new Promise((res) => { release = res; });
  const first = launcher.closeAllStaggered(true, { gapMs: () => 1, sleepFn: () => gate });
  const second = launcher.closeAllStaggered(true, { gapMs: () => 1, sleepFn: async () => {} });
  assert.equal(second.already, true);
  assert.equal(second.queued, 0);
  release();
  await first.done;
  assert.equal(calls.length, 3);
  assert.equal(launcher.closing, null);
});

test('a client that exits during the pauses is skipped without an extra pause', async () => {
  const { launcher, calls } = setup(3);
  await launcher.sync();
  const gaps = [];
  const r = launcher.closeAllStaggered(true, { gapMs: () => 1, sleepFn: async (ms) => { gaps.push(ms); launcher.instances.delete(102); } });
  await r.done;
  assert.deepEqual(calls.map((c) => c[0]), [100, 101]);
  assert.equal(gaps.length, 1);
});