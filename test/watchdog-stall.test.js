'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-stall-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Watchdog } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

function setup(noJoinRestartMin, logState, startedAgoMin = 60) {
  const wcfg = { ...DEFAULTS.watchdog, noJoinRestartMin, presenceCheck: false };
  const settings = { get: (k) => (k === 'watchdog' ? wcfg : k ? DEFAULTS[k] : DEFAULTS) };
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5, label: '5' } } };
  const accounts = { loaded: true, list: [acc], get: (id) => (id === 'a1' ? acc : null), session: () => ({}), save() {} };
  const launcher = new EventEmitter();
  launcher.pending = new Map();
  launcher.kills = [];
  const inst = { pid: 100, accountId: 'a1', startedAt: Date.now() - startedAgoMin * 60e3, logState };
  launcher.instances = new Map([[100, inst]]);
  launcher.byAccount = () => [...launcher.instances.values()];
  launcher.kill = async (pids, why) => { for (const p of pids) launcher.instances.delete(p); launcher.kills.push(why); };
  const wd = new Watchdog({ launcher, accounts, settings });
  wd.st('a1').armed = true;
  return { wd, launcher };
}

test('a client alive but without a join for longer than the limit is restarted', async () => {
  const { wd, launcher } = setup(30, { inGame: true, joinedAt: Date.now() - 40 * 60e3 });
  await wd.tick();
  assert.equal(launcher.kills.length, 1);
  assert.match(launcher.kills[0], /no server joined for 40 min/);
});

test('a recent join keeps the client alone', async () => {
  const { wd, launcher } = setup(30, { inGame: true, joinedAt: Date.now() - 5 * 60e3 });
  await wd.tick();
  assert.equal(launcher.kills.length, 0);
});

test('a client that never joined is judged from its start time', async () => {
  const { wd, launcher } = setup(30, { inGame: false }, 45);
  await wd.tick();
  assert.equal(launcher.kills.length, 1);
});

test('the rule is off at 0 and does nothing when the log is not matched', async () => {
  const off = setup(0, { inGame: true, joinedAt: Date.now() - 400 * 60e3 });
  await off.wd.tick();
  assert.equal(off.launcher.kills.length, 0);
  const noLog = setup(30, undefined, 400);
  await noLog.wd.tick();
  assert.equal(noLog.launcher.kills.length, 0);
});

test('stall restarts count toward the rejoin budget and turn keep-alive off at the limit', async () => {
  const { wd, launcher } = setup(30, { inGame: true, joinedAt: Date.now() - 40 * 60e3 });
  const acc = wd.accounts.get('a1');
  const s = wd.st('a1');
  s.drops = [Date.now(), Date.now(), Date.now()]; // 3 earlier drops, breaker is 4
  await wd.tick();
  assert.equal(acc.keepAlive.enabled, false);
  assert.equal(launcher.kills[0], 'rejoin budget reached');
});
