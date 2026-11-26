'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Launcher, metricsKey } = require('../src/launcher');
const { History } = require('../src/history');

const MIN = 60e3;
const GB = 1024 ** 3;

function launcherWith(instances, memory = null) {
  const l = new Launcher({ helper: {}, settings: { get: () => null }, accounts: { get: () => null } });
  for (const i of instances) l.instances.set(i.pid, i);
  l.lastMemory = memory;
  return l;
}

test('publicView reports private memory, a state label, growth and the fleet summary', () => {
  const now = Date.now();
  const inst = { pid: 100, accountId: 'a1', startedAt: now - 40 * MIN, privMB: 2700, logState: { inGame: true, jobId: 'j', placeId: 1 } };
  const l = launcherWith([inst], { freeBytes: 150 * GB, limitBytes: 191 * GB, at: now });
  const key = metricsKey(inst);
  for (let t = 0; t <= 40 * MIN; t += 15000) l.metrics.record(key, 2000 + 14 * (t / MIN), now - 40 * MIN + t);

  const v = l.publicView();
  const i = v.instances[0];
  assert.equal(i.privMB, 2700);
  assert.equal(i.state, 'ok');
  assert.equal(i.stateLabel, 'in game');
  assert.equal(i.growth.trend, 'creeping');
  assert.ok(Math.abs(i.growth.mbPerMin - 14) < 1);
  assert.ok(i.growth.spark.length > 1 && i.growth.spark.length <= 40);
  assert.equal(v.fleet.clients, 1);
  assert.equal(v.fleet.level, 'ok');
  assert.ok(Math.abs(v.fleet.freeGB - 150) < 1e-9);
  assert.equal(v.fleet.memoryAt, now);
});

test('publicView with no memory reading and a brand new client does not throw', () => {
  const inst = { pid: 5, accountId: 'a2', startedAt: Date.now() - 5000, privMB: undefined };
  const v = launcherWith([inst]).publicView();
  assert.equal(v.instances[0].state, 'launching');
  assert.equal(v.instances[0].privMB, null);
  assert.equal(v.instances[0].growth.trend, 'unknown');
  assert.equal(v.fleet.freeGB, null);
  assert.equal(v.fleet.memoryAt, 0);
});

test('a disconnected client shows as failed with the reason', () => {
  const inst = { pid: 6, accountId: 'a3', startedAt: Date.now() - 10 * MIN, privMB: 1800, logState: { inGame: false, disconnectedAt: Date.now() - 1000, reason: 'kicked' } };
  const i = launcherWith([inst]).publicView().instances[0];
  assert.equal(i.state, 'failed');
  assert.match(i.stateLabel, /kicked/);
});

test('metrics of clients that exited are pruned by key', () => {
  const a = { pid: 1, accountId: 'x', startedAt: 1000 };
  const b = { pid: 2, accountId: 'y', startedAt: 2000 };
  const l = launcherWith([a, b]);
  l.metrics.record(metricsKey(a), 1000, 1);
  l.metrics.record(metricsKey(b), 1000, 1);
  l.instances.delete(1);
  l.metrics.prune(new Set([...l.instances.values()].map(metricsKey)));
  assert.deepEqual([...l.metrics.series.keys()], [metricsKey(b)]);
});

test('History.last returns the newest entry or null', () => {
  const h = new History();
  assert.equal(h.last('nobody'), null);
  h.add('a', 'launch', 'first');
  h.add('a', 'join', 'second');
  assert.equal(h.last('a').msg, 'second');
  assert.equal(h.last('a').kind, 'join');
});
