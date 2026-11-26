'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickTrim, MIN_GAP_MS } = require('../src/trimplan');

const MIN = 60000;
const mk = (n, startedAt = 0) => Array.from({ length: n }, (_, i) => ({ pid: 100 + i, startedAt }));

test('off when the interval is 0 or there are no clients', () => {
  assert.strictEqual(pickTrim(mk(3), { now: 10 * MIN, trimMin: 0 }), null);
  assert.strictEqual(pickTrim([], { now: 10 * MIN, trimMin: 5 }), null);
});

test('a client is not due before one interval has passed since it started', () => {
  assert.strictEqual(pickTrim(mk(1, 0), { now: 4 * MIN, trimMin: 5 }), null);
  assert.strictEqual(pickTrim(mk(1, 0), { now: 5 * MIN, trimMin: 5 }), 100);
});

test('only one client is picked per step and the next waits for the gap', () => {
  const trimmedAt = new Map();
  let last = 0;
  const order = [];
  // 20 clients all started at 0, 2 minute interval: gap is 6 s
  for (let t = 2 * MIN; t < 2 * MIN + 140000; t += 3000) {
    const pid = pickTrim(mk(20), { now: t, trimMin: 2, lastTrimAt: last, trimmedAt });
    if (pid !== null) { order.push([t, pid]); trimmedAt.set(pid, t); last = t; }
  }
  assert.ok(order.length >= 20, 'every client was trimmed once');
  assert.deepStrictEqual(new Set(order.slice(0, 20).map((x) => x[1])).size, 20);
  for (let i = 1; i < order.length; i++) assert.ok(order[i][0] - order[i - 1][0] >= 6000, 'trims are at least 6 s apart');
});

test('the gap never drops below the minimum', () => {
  const trimmedAt = new Map();
  const a = pickTrim(mk(100), { now: 10 * MIN, trimMin: 1, lastTrimAt: 0, trimmedAt });
  assert.notStrictEqual(a, null);
  assert.strictEqual(pickTrim(mk(100), { now: 10 * MIN + MIN_GAP_MS - 1, trimMin: 1, lastTrimAt: 10 * MIN, trimmedAt: new Map([[a, 10 * MIN]]) }), null);
});

test('the most overdue client goes first', () => {
  const inst = [{ pid: 1, startedAt: 0 }, { pid: 2, startedAt: 0 }];
  const trimmedAt = new Map([[1, 20 * MIN], [2, 10 * MIN]]);
  assert.strictEqual(pickTrim(inst, { now: 40 * MIN, trimMin: 5, lastTrimAt: 0, trimmedAt }), 2);
});

test('a client that was just trimmed is not picked again', () => {
  const inst = [{ pid: 1, startedAt: 0 }];
  assert.strictEqual(pickTrim(inst, { now: 12 * MIN, trimMin: 5, lastTrimAt: 0, trimmedAt: new Map([[1, 10 * MIN]]) }), null);
});

test('bad input is ignored', () => {
  assert.strictEqual(pickTrim([{ pid: 'x' }, null], { now: 10 * MIN, trimMin: 1 }), null);
  assert.strictEqual(pickTrim(mk(2), { now: 10 * MIN, trimMin: NaN }), null);
});
const { worthTrimming, ramIsTight, MIN_WS_MB, REGROW_MB } = require('../src/trimplan');

test('a client under the minimum RAM is not worth trimming; an unknown size still is', () => {
  assert.strictEqual(worthTrimming({ pid: 1, memMB: MIN_WS_MB - 1 }), false);
  assert.strictEqual(worthTrimming({ pid: 1, memMB: MIN_WS_MB + 1 }), true);
  assert.strictEqual(worthTrimming({ pid: 1 }), true);
});

test('after a trim the client is skipped until it has regrown enough', () => {
  assert.strictEqual(worthTrimming({ pid: 1, memMB: 1500, trimBaseMB: 1400 }), false);
  assert.strictEqual(worthTrimming({ pid: 1, memMB: 1400 + REGROW_MB - 1, trimBaseMB: 1400 }), false, 'the larger of the fixed and percentage regrowth applies');
  assert.strictEqual(worthTrimming({ pid: 1, memMB: 1400 + 1400 * 0.3 + 1, trimBaseMB: 1400 }), true);
  assert.strictEqual(worthTrimming({ pid: 1, memMB: 900, trimBaseMB: 150 }), true);
});

test('pickTrim leaves clients alone that are not worth trimming and picks the next due one', () => {
  const insts = [
    { pid: 1, startedAt: 0, memMB: 300 },
    { pid: 2, startedAt: 1000, memMB: 2000 },
  ];
  assert.strictEqual(pickTrim(insts, { now: 10 * MIN, trimMin: 5 }), 2);
  assert.strictEqual(pickTrim([insts[0]], { now: 10 * MIN, trimMin: 5 }), null);
});

test('ramIsTight: trimming only runs while free RAM is under the chosen share', () => {
  const GB = 1024 ** 3;
  assert.strictEqual(ramIsTight(20 * GB, 32 * GB, 50), false);
  assert.strictEqual(ramIsTight(12 * GB, 32 * GB, 50), true);
  assert.strictEqual(ramIsTight(30 * GB, 32 * GB, 100), true, '100 means always');
  assert.strictEqual(ramIsTight(NaN, 32 * GB, 50), true, 'an unreadable value never switches trimming off');
  assert.strictEqual(ramIsTight(1 * GB, 0, 50), true);
});
test('30 s and 1 min intervals work: trims stay at least 5 s apart, so 6 clients fit 30 s and 12 clients fit 60 s', () => {
  for (const [n, trimMin, cycleMs] of [[5, 0.5, 30000], [6, 0.5, 30000], [12, 1, 60000], [20, 1, 100000]]) {
    const trimmedAt = new Map(); let last = 0; const times = [];
    for (let t = 2 * MIN; t < 2 * MIN + 3 * cycleMs; t += 500) {
      const pid = pickTrim(mk(n), { now: t, trimMin, lastTrimAt: last, trimmedAt });
      if (pid !== null) { times.push(t); trimmedAt.set(pid, t); last = t; }
    }
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= MIN_GAP_MS);
    const perClient = new Map(); for (const [pid, t] of trimmedAt) perClient.set(pid, t);
    assert.strictEqual(perClient.size, n, 'every client got trimmed');
    assert.ok(times.length >= n * 2, 'each client was trimmed at least twice in three cycles');
  }
});

