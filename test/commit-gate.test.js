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

function setup(memory) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const accounts = new EventEmitter();
  Object.assign(accounts, { list: [], loaded: true, get: () => null, save() {}, session: () => ({}) });
  const helper = { procs: async () => [], call: async () => 0 };
  if (memory) helper.memory = memory;
  return new Launcher({ helper, settings, accounts });
}

test('a launch waits when free commit is under 10 GB, and says why', async () => {
  const launcher = setup(async () => ({ limitBytes: 95 * GB, freeBytes: 9.6 * GB }));
  await assert.rejects(launcher.commitGate('alt0'), (e) => e.commitShort === true && /9\.6 GB free/.test(e.message));
});

test('a launch goes ahead when there is at least 10 GB free', async () => {
  const launcher = setup(async () => ({ limitBytes: 160 * GB, freeBytes: 10 * GB }));
  await launcher.commitGate('alt0');
});

test('no reading (helper too old, or it failed) never blocks a launch', async () => {
  await setup(null).commitGate('alt0');
  await setup(async () => { throw new Error('helper timeout: memory'); }).commitGate('alt0');
  await setup(async () => ({})).commitGate('alt0');
});
