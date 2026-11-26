'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-wd-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { api } = require('../src/roblox');
const { Watchdog } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

function setup() {
  const settings = { get: (k) => (k ? DEFAULTS[k] : DEFAULTS) };
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5, label: '5' } } };
  const accounts = { loaded: true, list: [acc], get: (id) => (id === 'a1' ? acc : null), session: () => ({}) };
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  launcher.pending = new Map();
  launcher.launches = [];
  launcher.kills = [];
  launcher.byAccount = (id) => [...launcher.instances.values()].filter((i) => i.accountId === id);
  launcher.launch = async (id, target) => { launcher.launches.push(target); launcher.instances.set(100 + launcher.launches.length, { pid: 100 + launcher.launches.length, accountId: id, startedAt: Date.now() - 10 * 60e3 }); return {}; };
  launcher.kill = async (pids, why) => { for (const p of pids) { const i = launcher.instances.get(p); launcher.instances.delete(p); launcher.kills.push(why); if (i) launcher.emit('exit', { ...i, killReason: why }); } };
  const wd = new Watchdog({ launcher, accounts, settings });
  wd.st('a1').armed = true; // a client of this account was open
  wd.launcher.on('exit', () => {}); // start() not called (no timers); attach exit handler manually
  return { wd, launcher, acc };
}

test('launches when not running, then restarts after repeated not-in-game presence', async () => {
  const { wd, launcher } = setup();
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 1, 'should launch once');

  let presenceType = 2;
  api.getPresence = async () => [{ userPresenceType: presenceType, gameId: 'g', placeId: 5 }];
  const s = wd.st('a1');
  await wd.checkPresence(wd.accounts.get('a1'), [...launcher.instances.values()][0], s);
  assert.equal(s.badChecks, 0);

  presenceType = 1; // online but not in game = kicked
  const inst = [...launcher.instances.values()][0];
  await wd.checkPresence(wd.accounts.get('a1'), inst, s);
  assert.equal(launcher.kills.length, 0, 'one bad check is not enough');
  await wd.checkPresence(wd.accounts.get('a1'), inst, s);
  assert.deepEqual(launcher.kills, ['disconnected/kicked']);
  assert.ok(s.nextAttemptAt > Date.now(), 'relaunch is delayed');

  // after delay passes it relaunches
  s.nextAttemptAt = Date.now() - 1;
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 2);
});

test('respects per-hour relaunch cap and disabled keep-alive', async () => {
  const { wd, launcher, acc } = setup();
  const s = wd.st('a1');
  s.launches = Array.from({ length: DEFAULTS.watchdog.maxRelaunchesPerHour }, () => Date.now());
  await wd.tick();
  assert.equal(launcher.launches.length, 0);
  assert.equal(s.status, 'throttled');

  acc.keepAlive.enabled = false;
  await wd.tick();
  assert.equal(s.status, 'off');
});

test('turning keep-alive on for an account that is not open does not launch it', async () => {
  const { wd, launcher } = setup();
  const s = wd.st('a1');
  s.armed = false;
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 0, 'nothing is started by itself');
  assert.equal(s.status, 'idle');
  assert.equal(s.nextAttemptAt, 0);
});

test('an account that is launched and then closes is relaunched', async () => {
  const { wd, launcher } = setup();
  const s = wd.st('a1');
  s.armed = false;
  await wd.tick();
  assert.equal(launcher.launches.length, 0);
  // the person launches it: the watchdog sees the client and remembers it was open
  launcher.instances.set(7, { pid: 7, accountId: 'a1', startedAt: Date.now() - 10 * 60e3 });
  await wd.tick();
  assert.equal(s.armed, true);
  assert.equal(s.status, 'running');
  // the window closes (crash or closed by hand)
  launcher.instances.delete(7);
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 1, 'relaunched once the open client was gone');
});

test('switching keep-alive off forgets that the account was open', async () => {
  const { wd, launcher, acc } = setup();
  const s = wd.st('a1');
  assert.equal(s.armed, true);
  acc.keepAlive.enabled = false;
  await wd.tick();
  assert.equal(s.armed, false);
  acc.keepAlive.enabled = true;
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 0, 'turning it back on does not launch a closed account');
});

test('with "also start accounts that are not open" on, keep-alive launches them', async () => {
  const { wd, launcher } = setup();
  const s = wd.st('a1');
  s.armed = false;
  const real = wd.settings;
  wd.settings = { get: (k) => (k === 'watchdog' ? { ...DEFAULTS.watchdog, startOnEnable: true } : real.get(k)) };
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 1);
});

test('invalid cookie never launches', async () => {
  const { wd, launcher, acc } = setup();
  acc.status = 'invalid';
  await wd.tick();
  assert.equal(launcher.launches.length, 0);
  assert.equal(wd.st('a1').status, 'error');
});

test('job target falls back to public after repeated misses', () => {
  const { wd, acc } = setup();
  acc.keepAlive.target = { type: 'job', placeId: 5, jobId: 'abc', label: 'x' };
  const s = wd.st('a1');
  assert.equal(wd.pickTarget(acc, s, DEFAULTS.watchdog).type, 'job');
  s.jobMisses = 2;
  assert.equal(wd.pickTarget(acc, s, DEFAULTS.watchdog).type, 'game');
});
