'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-cancel-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher } = require('../src/launcher');
const { DEFAULTS } = require('../src/settings');

function setup(n = 3) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const list = Array.from({ length: n }, (_, i) => ({ id: `acc${i}`, userId: 1000 + i, username: `alt${i}`, status: 'valid', fields: {}, keepAlive: { enabled: false } }));
  const accounts = new EventEmitter();
  Object.assign(accounts, { list, loaded: true, get: (id) => list.find((a) => a.id === id) || null, displayName: (a) => a.username, save() {}, session: () => ({}) });
  const helper = { procs: async () => [], call: async () => 0 };
  return new Launcher({ helper, settings, accounts });
}
const target = { type: 'game', placeId: 1, label: 'test' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('cancelling queued launches stops them before they start', async () => {
  const launcher = setup(3);
  const started = [];
  launcher._launch = async (accountId) => { started.push(accountId); await sleep(40); return { pid: 1 }; };
  const p0 = launcher.launch('acc0', target);
  const p1 = launcher.launch('acc1', target);
  const p2 = launcher.launch('acc2', target);
  assert.equal(launcher.cancelQueued(['acc1', 'acc2']), 2);
  assert.deepEqual(launcher.queued, ['acc0'], 'cancelled accounts leave the queue at once');
  await p0;
  await assert.rejects(p1, (e) => e.cancelled === true);
  await assert.rejects(p2, (e) => e.cancelled === true);
  assert.deepEqual(started, ['acc0'], 'cancelled launches never reach _launch');
  assert.deepEqual(launcher.queued, []);
  assert.equal(launcher.isHeld('acc1'), true, 'keep-alive may not bring a cancelled account straight back');
});

test('a person asking for a launch again lifts the cancel hold', async () => {
  const launcher = setup(1);
  launcher._launch = async () => ({ pid: 1 });
  const p = launcher.launch('acc0', target);
  await p;
  launcher.holds.set('acc0', Date.now() + 60000);
  await launcher.launch('acc0', target, 'manual');
  assert.equal(launcher.isHeld('acc0'), false);
});

test('cancel with nothing queued does nothing', () => {
  const launcher = setup(1);
  assert.equal(launcher.cancelQueued(null), 0);
});