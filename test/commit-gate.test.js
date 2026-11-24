'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-commit-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher } = require('../src/launcher');
const { DEFAULTS } = require('../src/settings');

const GB = 1024 ** 3;
function setup(memory, running = []) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const accounts = new EventEmitter();
  Object.assign(accounts, { list: [], loaded: true, get: () => null, save() {}, session: () => ({}) });
  const helper = { procs: async () => running, call: async () => 0 };
  if (memory) helper.memory = memory;
  return new Launcher({ helper, settings, accounts });
}
const clients = (n, privMB) => Array.from({ length: n }, (_, i) => ({ pid: i + 1, privMB }));

test('a launch waits when free commit is under 10 GB, and says why', async () => {
  const launcher = setup(async () => ({ limitBytes: 95 * GB, freeBytes: 9.6 * GB }));
  await assert.rejects(launcher.commitGate('alt0'), (e) => e.commitShort === true && /9\.6 GB free/.test(e.message));
});

test('a launch goes ahead when there is at least 10 GB free and room for another client', async () => {
  const launcher = setup(async () => ({ limitBytes: 160 * GB, freeBytes: 10 * GB }));
  await launcher.commitGate('alt0');
});

test('no reading (helper too old, or it failed) never blocks a launch', async () => {
  await setup(null).commitGate('alt0');
  await setup(async () => { throw new Error('helper timeout: memory'); }).commitGate('alt0');
  await setup(async () => ({})).commitGate('alt0');
});

test('the PC has no room for another client once the running ones have grown, even with free commit left', async () => {
  // 95 GB limit, clients at 9 GB each -> room for 8 (9 GB x 1.15, keeping 6 GB back). Nine are running.
  const launcher = setup(async () => ({ limitBytes: 95 * GB, freeBytes: 30 * GB }), clients(9, 9000));
  await assert.rejects(launcher.commitGate('alt9'), (e) => e.commitShort === true && /room for 8 clients/.test(e.message));
});

test('a client that has grown to 12 GB shrinks the room, so the next launch waits', async () => {
  const launcher = setup(async () => ({ limitBytes: 95 * GB, freeBytes: 40 * GB }), clients(6, 12000));
  await assert.rejects(launcher.commitGate('alt6'), (e) => e.commitShort === true && /room for 6 clients/.test(e.message));
});

test('with room left, a launch goes ahead', async () => {
  const launcher = setup(async () => ({ limitBytes: 95 * GB, freeBytes: 30 * GB }), clients(5, 9000));
  await launcher.commitGate('alt5');
});
