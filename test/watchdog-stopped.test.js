'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-stopped-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Watchdog } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

function setup(held) {
  const settings = { get: (k) => (k ? DEFAULTS[k] : DEFAULTS) };
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5 } } };
  const accounts = { loaded: true, list: [acc], get: () => acc, session: () => ({}) };
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  launcher.pending = new Map();
  launcher.launches = [];
  launcher.byAccount = () => [];
  launcher.isHeld = () => held;
  launcher.launch = async (id, target) => { launcher.launches.push(target); return {}; };
  const wd = new Watchdog({ launcher, accounts, settings });
  wd.st('a1').armed = true;
  return { wd, launcher };
}

test('an account closed on purpose is "stopped", never "waiting" (the UI calls waiting "recovering"), and is not relaunched', async () => {
  const { wd, launcher } = setup(true);
  await wd.tick();
  const s = wd.st('a1');
  assert.equal(s.status, 'stopped');
  assert.match(s.msg, /closed on purpose/);
  assert.equal(launcher.launches.length, 0);
  assert.equal(s.armed, false);
});

test('an account that is not held keeps the normal behaviour', async () => {
  const { wd, launcher } = setup(false);
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 1);
});
