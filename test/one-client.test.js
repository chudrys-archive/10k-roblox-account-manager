'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-one-client-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher } = require('../src/launcher');
const { DEFAULTS } = require('../src/settings');

function setup(procs) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: true, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const accounts = new EventEmitter();
  Object.assign(accounts, { list: [], loaded: true, get: () => null, save() {}, session: () => ({}) });
  const helper = { procs, call: async () => 0 };
  const l = new Launcher({ helper, settings, accounts });
  l.clientWaitMs = 1500;
  return l;
}

test('one client at a time: a launch is allowed when no client is running', async () => {
  const l = setup(async () => []);
  await l.assertNoOtherClient();
});

test('one client at a time: a second launch is refused while a client is running', async () => {
  const l = setup(async () => [{ pid: 4242, title: 'Roblox' }]);
  await assert.rejects(l.assertNoOtherClient(), /Another Roblox client is still running/);
});

test('one client at a time: a closing client gets a short wait, then the launch goes ahead', async () => {
  let reads = 0;
  const l = setup(async () => (++reads < 3 ? [{ pid: 4242 }] : []));
  await l.assertNoOtherClient();
  assert.ok(reads >= 3);
});

test('one client at a time: a launch is refused when the process list cannot be read', async () => {
  const l = setup(async () => { throw new Error('helper down'); });
  await assert.rejects(l.assertNoOtherClient(), /Could not read the running Roblox processes/);
});