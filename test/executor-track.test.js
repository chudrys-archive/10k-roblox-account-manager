'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { Executor } = require('../src/executor');

function make(cfgPatch = {}, clients = 2) {
  const cfg = { enabled: true, relaunch: false, startWithManager: false, processName: 'Potassium.exe', afterLaunch: { command: 'C:\\tools\\attach.ps1', args: '', delaySec: 0, rerunOnRestart: true }, ...cfgPatch };
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  for (let i = 1; i <= clients; i++) launcher.instances.set(i, { pid: i, accountId: 'acc' + i });
  const sent = [];
  const alerts = { send: (...a) => sent.push(a) };
  const ex = new Executor({ settings: { get: (k) => (k === 'executor' ? cfg : undefined), update() {} }, launcher, accounts: null, alerts });
  const hooks = [];
  ex.queueHook = (inst) => hooks.push(inst.pid);
  return { ex, sent, hooks, launcher, cfg };
}

test('when the executor comes back after closing, the after-launch command runs again for every running client', () => {
  const { ex, hooks } = make();
  ex.track(1, 1000);          // open
  assert.deepEqual(hooks, []);
  ex.track(0, 5000);          // closed
  assert.equal(ex.wentDown, true);
  ex.track(1, 9000);          // back
  assert.deepEqual(hooks, [1, 2]);
  assert.equal(ex.wentDown, false);
  ex.track(1, 12000);         // still open: nothing more
  assert.deepEqual(hooks, [1, 2]);
});

test('an executor that was already open when the manager started is not re-attached to anything', () => {
  const { ex, hooks } = make();
  ex.track(1, 1000);
  ex.track(1, 11000);
  assert.deepEqual(hooks, []);
});

test('re-running is off without a command, with the setting off, or with the feature off', () => {
  for (const patch of [{ afterLaunch: { command: '', args: '', delaySec: 0, rerunOnRestart: true } }, { afterLaunch: { command: 'C:\\a.ps1', args: '', delaySec: 0, rerunOnRestart: false } }, { enabled: false }]) {
    const { ex, hooks } = make(patch);
    ex.track(1, 1000); ex.track(0, 2000); ex.track(1, 3000);
    assert.deepEqual(hooks, [], JSON.stringify(patch));
  }
});

test('an executor that stays closed while clients run sends one alert after 90 seconds', () => {
  const { ex, sent } = make();
  ex.track(1, 0);
  ex.track(0, 10_000);
  ex.track(0, 60_000);
  assert.equal(sent.length, 0, 'not yet');
  ex.track(0, 101_000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'executor');
  assert.match(sent[0][2], /2 Roblox client\(s\) are running without it/);
  ex.track(0, 200_000);
  assert.equal(sent.length, 1, 'only once per time it goes down');
  ex.track(1, 210_000);
  ex.track(0, 220_000);
  ex.track(0, 320_000);
  assert.equal(sent.length, 2, 'and again the next time');
});

test('no alert when no client runs, when it is held for an experiment, or when it was never open', () => {
  const none = make({}, 0);
  none.ex.track(1, 0); none.ex.track(0, 1000); none.ex.track(0, 500_000);
  assert.equal(none.sent.length, 0);

  const held = make();
  held.ex.track(1, 0); held.ex.track(0, 1000); held.ex.held = true; held.ex.track(0, 500_000);
  assert.equal(held.sent.length, 0);

  const never = make();
  never.ex.track(0, 0); never.ex.track(0, 500_000);
  assert.equal(never.sent.length, 0);
});
