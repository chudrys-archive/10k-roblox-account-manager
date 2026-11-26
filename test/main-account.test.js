'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-main-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher } = require('../src/launcher');
const { DEFAULTS } = require('../src/settings');

function setup(n, over = {}) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false, ...over };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const list = Array.from({ length: n }, (_, i) => ({ id: `acc${i}`, userId: 1000 + i, username: `alt${i}`, alias: '', group: 'Default', status: 'valid', fields: {}, keepAlive: { enabled: false }, main: false }));
  const accounts = new EventEmitter();
  Object.assign(accounts, { list, loaded: true, get: (id) => list.find((a) => a.id === id) || null, displayName: (a) => a.username, save() {}, session: () => ({}) });
  let procs = [];
  const calls = [];
  const helper = {
    procs: async () => procs,
    call: async (cmd, a) => { if (cmd === 'kill') { calls.push(...a.pids); procs = procs.filter((p) => !a.pids.includes(p.pid)); return a.pids.length; } return 0; },
  };
  const launcher = new Launcher({ helper, settings, accounts });
  const start = new Date().toISOString();
  procs = list.map((a, i) => ({ pid: 100 + i, btid: `T${i}`, hwnd: 1000 + i, title: '', memMB: 100, hung: false, start }));
  list.forEach((a, i) => launcher.btids.set(`T${i}`, { accountId: a.id, at: Date.now() }));
  return { launcher, calls, list };
}

test('close all leaves the Main account running', async () => {
  const { launcher, calls, list } = setup(4);
  list[1].main = true;
  await launcher.sync();
  const r = launcher.closeAllStaggered(true, { gapMs: () => 0, sleepFn: async () => {} });
  assert.equal(r.queued, 3);
  await r.done;
  assert.deepEqual(calls.sort(), [100, 102, 103]);
  assert.ok(launcher.instances.has(101), 'main client still tracked');
});

test('with the setting off, close all closes the Main account too', async () => {
  const { launcher, calls, list } = setup(3, { closeAllKeepsMain: false });
  list[0].main = true;
  await launcher.sync();
  const r = launcher.closeAllStaggered(true, { gapMs: () => 0, sleepFn: async () => {} });
  assert.equal(r.queued, 3);
  await r.done;
  assert.deepEqual(calls.sort(), [100, 101, 102]);
});

test('stopAccounts(null) does not hold the Main account, so keep-alive keeps it up', () => {
  const { launcher, list } = setup(3);
  list[2].main = true;
  launcher.stopAccounts(null);
  assert.equal(launcher.isHeld('acc0'), true);
  assert.equal(launcher.isHeld('acc1'), true);
  assert.equal(launcher.isHeld('acc2'), false);
});

test('stopAccounts with explicit ids still stops a Main account you picked', () => {
  const { launcher, list } = setup(2);
  list[0].main = true;
  launcher.stopAccounts(['acc0']);
  assert.equal(launcher.isHeld('acc0'), true);
});

test('Main account survives settings and accounts sanitizers', () => {
  const { sanitizePerf } = require('../src/perf');
  assert.equal(sanitizePerf({ fpsCap: 10 }), null);
  assert.deepEqual(sanitizePerf({ fpsCap: 30 }), { fpsCap: 30, graphicsLevel: 0, windowWidth: 0, windowHeight: 0 });
  assert.equal(DEFAULTS.closeAllKeepsMain, true);
});
