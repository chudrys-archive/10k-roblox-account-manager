'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Experiment, summarizeArm, compareArms, reportMarkdown } = require('../src/experiments');

const MIN = 60e3;
const line = (rate, base, minutes, step = 0.5) => { const o = []; for (let m = 0; m <= minutes; m += step) o.push({ t: m * MIN, v: base + rate * m }); return o; };

test('summarizeArm ignores warm-up and takes medians', () => {
  const s = new Map([['a', line(10, 1000, 20)], ['b', line(12, 1100, 20)], ['c', line(8, 900, 20)]]);
  const r = summarizeArm(s);
  assert.equal(r.clients, 3); assert.equal(r.measured, 3);
  assert.ok(Math.abs(r.slopeMBMin - 10) < 0.2);
  assert.ok(r.baselineMB > 1000 && r.baselineMB < 1500);
});

test('summarizeArm gives null slope when too little data after warm-up', () => {
  const r = summarizeArm(new Map([['a', line(10, 1000, 6)]]));
  assert.equal(r.measured, 0); assert.equal(r.slopeMBMin, null);
});

test('compareArms: refuses small samples, detects real and noise differences', () => {
  const arm = (slope, n) => ({ measured: n, slopeMBMin: slope, baselineMB: 1000 });
  assert.equal(compareArms(arm(10, 2), arm(2, 2)).verdict, 'not-enough-data');
  assert.equal(compareArms(arm(14, 5), arm(5, 5)).verdict, 'second-grows-less');
  assert.equal(compareArms(arm(5, 5), arm(14, 5)).verdict, 'second-grows-more');
  assert.equal(compareArms(arm(14, 5), arm(13, 5)).verdict, 'no-clear-difference');
});

test('Experiment runs arms in order, restores the setting and reports', async () => {
  let clock = 0; const calls = []; let applied = 'orig';
  const api = {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    apply: async (k, v) => { applied = v; calls.push(`apply:${v}`); },
    launch: async (ids) => { calls.push(`launch:${ids.length}`); },
    sample: () => [{ key: 'a', privMB: 1000 + clock / MIN * 10 }, { key: 'b', privMB: 1100 + clock / MIN * 10 }, { key: 'c', privMB: 900 + clock / MIN * 10 }],
    closeAll: async () => { calls.push('close'); },
  };
  const e = new Experiment({ variable: 'graphicsApi', arms: [{ label: 'D3D11', value: 'd3d11' }, { label: 'Vulkan', value: 'vulkan' }], accountIds: ['1', '2', '3'], minutes: 15, api, original: 'auto' });
  const v = await e.run();
  assert.equal(v.status, 'done');
  assert.deepEqual(calls, ['apply:d3d11', 'launch:3', 'close', 'apply:vulkan', 'launch:3', 'close', 'apply:auto']);
  assert.equal(applied, 'auto');
  assert.equal(v.results.length, 2);
  assert.match(reportMarkdown({ name: 'x', variable: 'graphicsApi', clients: 3, minutes: 15, startedAt: 0, results: e.results }), /no-clear|within noise|Growth/);
});

test('Experiment restores the setting when launching throws', async () => {
  let applied = null;
  const api = { now: () => 0, sleep: async () => {}, apply: async (k, v) => { applied = v; }, launch: async () => { throw new Error('no roblox'); }, sample: () => [], closeAll: async () => {} };
  const e = new Experiment({ variable: 'v', arms: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], accountIds: ['1'], minutes: 5, api, original: 'orig' });
  const v = await e.run();
  assert.equal(v.status, 'failed'); assert.equal(v.error, 'no roblox'); assert.equal(applied, 'orig');
});

test('Experiment validates its input and can be stopped', async () => {
  assert.throws(() => new Experiment({ variable: 'v', arms: [{ label: 'a', value: 1 }], accountIds: ['1'], minutes: 5, api: {} }));
  assert.throws(() => new Experiment({ variable: 'v', arms: [{}, {}], accountIds: [], minutes: 5, api: {} }));
  let clock = 0;
  const api = { now: () => clock, sleep: async (ms) => { clock += ms; e.stop(); }, apply: async () => {}, launch: async () => {}, sample: () => [], closeAll: async () => {} };
  const e = new Experiment({ variable: 'v', arms: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], accountIds: ['1'], minutes: 5, api });
  assert.equal((await e.run()).status, 'stopped');
});
