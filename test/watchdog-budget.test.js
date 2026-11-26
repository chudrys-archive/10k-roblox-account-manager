'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-budget-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Watchdog } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

function setup(overWatchdog = {}) {
  const watch = { ...DEFAULTS.watchdog, ...overWatchdog };
  const settings = { get: (k) => (k === 'watchdog' ? watch : DEFAULTS[k]) };
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5, label: '5' } } };
  const accounts = { loaded: true, list: [acc], get: (id) => (id === 'a1' ? acc : null), session: () => ({}) };
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  launcher.pending = new Map();
  launcher.byAccount = () => [];
  launcher.launches = [];
  launcher.launch = async (id, target) => { launcher.launches.push(target); return {}; };
  launcher.kill = async () => 1;
  const notes = [];
  const wd = new Watchdog({ launcher, accounts, settings, alerts: { send() {} } });
  wd.st('a1').armed = true; // a client of this account was open
  wd.on('event', (a, kind, msg) => notes.push([kind, msg]));
  return { wd, acc, launcher, notes };
}

const T0 = 1e12;
const MIN = 60e3;

test('the 4th disconnect inside the window turns keep-alive off for that account only', () => {
  const { wd, acc, notes } = setup();
  const s = wd.st('a1');
  for (let i = 0; i < 3; i++) assert.equal(wd.recordDrop(acc, s, T0 + i * MIN), false);
  assert.equal(acc.keepAlive.enabled, true);
  assert.equal(wd.recordDrop(acc, s, T0 + 3 * MIN), true);
  assert.equal(acc.keepAlive.enabled, false);
  assert.match(s.issue, /4 disconnects in 60 min/);
  assert.equal(s.status, 'off');
  assert.equal(notes[0][0], 'breaker');
});

test('drops older than the window do not count', () => {
  const { wd, acc } = setup({ breakerWindowMin: 10 });
  const s = wd.st('a1');
  for (let i = 0; i < 3; i++) wd.recordDrop(acc, s, T0 + i * MIN);
  assert.equal(wd.recordDrop(acc, s, T0 + 3 * 60 * MIN), false, 'the earlier three have expired');
  assert.equal(acc.keepAlive.enabled, true);
});

test('a budget of 0 turns the breaker off', () => {
  const { wd, acc } = setup({ breakerDisconnects: 0 });
  const s = wd.st('a1');
  for (let i = 0; i < 10; i++) assert.equal(wd.recordDrop(acc, s, T0 + i), false);
  assert.equal(acc.keepAlive.enabled, true);
});

test('while the captcha guard is paused, the watchdog does not relaunch anything', async () => {
  const { wd, launcher } = setup();
  const guard = { paused: true };
  wd.guard = guard;
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 0);
  assert.equal(wd.st('a1').status, 'paused');
  guard.paused = false;
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 1, 'relaunches once the guard is resumed');
});

test('a launch refused by the captcha guard is not counted as a failed launch', async () => {
  const { wd, launcher } = setup();
  launcher.launch = async () => { throw Object.assign(new Error('paused'), { guardPaused: true }); };
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  const s = wd.st('a1');
  assert.equal(s.failures, 0);
  assert.equal(s.launches.length, 0, 'the attempt does not use up the hourly budget');
  assert.equal(s.status, 'paused');
});
