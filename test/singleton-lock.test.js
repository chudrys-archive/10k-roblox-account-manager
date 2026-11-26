'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Launcher } = require('../src/launcher');

function fakeLauncher(procs, call) {
  const l = Object.create(Launcher.prototype);
  l.helper = { procs: async () => procs, call };
  return l;
}

test('freeSingletonLock asks the helper to close the event in every running client and counts what it closed', async () => {
  let seen;
  const l = fakeLauncher([{ pid: 11 }, { pid: 22 }], async (cmd, args) => { seen = { cmd, args }; return ['11:ROBLOX_singletonEvent', '22:ROBLOX_singletonEvent']; });
  assert.equal(await l.freeSingletonLock(), 2);
  assert.equal(seen.cmd, 'release_singleton');
  assert.deepEqual(seen.args.pids, [11, 22]);
  assert.deepEqual(seen.args.names, ['ROBLOX_singletonEvent']);
});

test('freeSingletonLock does nothing without clients and survives a bad helper answer', async () => {
  let called = false;
  assert.equal(await fakeLauncher([], async () => { called = true; return []; }).freeSingletonLock(), 0);
  assert.equal(called, false);
  assert.equal(await fakeLauncher([{ pid: 5 }, { pid: 'x' }], async () => null).freeSingletonLock(), 0);
});
