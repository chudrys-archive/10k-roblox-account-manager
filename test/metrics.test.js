'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MetricsStore, linearSlope, trendOf, hoursToLimit, downsample, classifyClient, fleetSummary, MAX_POINTS,
} = require('../src/metrics');

const MIN = 60e3;
const GB = 1024 ** 3;
const T0 = Date.UTC(2026, 10, 24, 20, 0, 0);

function feed(store, key, { start = T0, minutes, everyMs = 15000, base = 2000, perMin = 0 }) {
  for (let t = 0; t <= minutes * MIN; t += everyMs) store.record(key, base + (perMin * t) / MIN, start + t);
}

test('linearSlope recovers a straight line and refuses too little data', () => {
  const pts = [0, 1, 2, 3, 4].map((m) => ({ t: T0 + m * MIN, v: 1000 + 14 * m }));
  assert.ok(Math.abs(linearSlope(pts) - 14) < 1e-9);
  assert.equal(linearSlope(pts.slice(0, 2)), null);
  assert.equal(linearSlope([{ t: T0, v: 1 }, { t: T0 + 10000, v: 2 }, { t: T0 + 20000, v: 3 }]), null); // spans under 2 minutes
  assert.equal(linearSlope(null), null);
});

test('trendOf separates flat, creeping and fast growth', () => {
  assert.equal(trendOf(0.4).id, 'flat');
  assert.equal(trendOf(14).id, 'creeping');
  assert.equal(trendOf(390).id, 'climbing');
  assert.equal(trendOf(null).id, 'unknown');
  assert.equal(trendOf(NaN).id, 'unknown');
});

test('store measures a creep and a fast climb from synthetic readings', () => {
  const s = new MetricsStore();
  feed(s, 'creep', { minutes: 30, perMin: 14 });
  feed(s, 'fast', { minutes: 30, perMin: 390 });
  const now = T0 + 30 * MIN;
  assert.ok(Math.abs(s.slope('creep', { now }) - 14) < 0.5);
  assert.ok(Math.abs(s.slope('fast', { now }) - 390) < 5);
});

test('the first five minutes of a client are not counted as growth', () => {
  const s = new MetricsStore();
  for (let t = 0; t <= 5 * MIN; t += 15000) s.record('c', 500 + (t / MIN) * 400, T0 + t); // loading ramp
  for (let t = 5 * MIN + 15000; t <= 25 * MIN; t += 15000) s.record('c', 2500, T0 + t);   // then flat
  const slope = s.slope('c', { windowMs: 30 * MIN, now: T0 + 25 * MIN });
  assert.ok(Math.abs(slope) < 0.5, `slope ${slope}`);
  assert.ok(s.slope('c', { windowMs: 30 * MIN, now: T0 + 25 * MIN, skipWarmup: false }) > 5);
});

test('slope is null until there is enough history', () => {
  const s = new MetricsStore();
  assert.equal(s.slope('missing'), null);
  s.record('c', 2000, T0);
  s.record('c', 2010, T0 + 15000);
  assert.equal(s.slope('c', { now: T0 + 20000, skipWarmup: false }), null);
});

test('readings that are too frequent, backwards, negative or not numbers are dropped', () => {
  const s = new MetricsStore();
  assert.equal(s.record('c', 2000, T0), true);
  assert.equal(s.record('c', 2001, T0 + 5000), false);
  assert.equal(s.record('c', 2002, T0 - 1000), false);
  assert.equal(s.record('c', -5, T0 + 30000), false);
  assert.equal(s.record('c', NaN, T0 + 30000), false);
  assert.equal(s.record('c', Infinity, T0 + 30000), false);
  assert.equal(s.record(null, 5, T0 + 30000), false);
  assert.equal(s.points('c').length, 1);
});

test('a long run stays inside the point limit and keeps its slope and newest reading', () => {
  const s = new MetricsStore({ maxPoints: 64 });
  feed(s, 'c', { minutes: 6 * 60, perMin: 14 }); // six hours, 1440 readings offered
  assert.ok(s.points('c').length < 64);
  const now = T0 + 6 * 60 * MIN;
  assert.ok(Math.abs(s.latest('c') - (2000 + 14 * 360)) < 14 * 20, 'newest kept reading is within one stored gap of the newest offered one');
  assert.ok(Math.abs(s.slope('c', { windowMs: 5 * 60 * MIN, now }) - 14) < 0.5);
  assert.ok(MAX_POINTS >= 8);
});

test('prune and forget remove series', () => {
  const s = new MetricsStore();
  feed(s, 'a', { minutes: 1 }); feed(s, 'b', { minutes: 1 }); feed(s, 'c', { minutes: 1 });
  s.forget('a');
  s.prune(new Set(['b']));
  assert.deepEqual([...s.series.keys()], ['b']);
});

test('downsample averages neighbours and never returns more than asked', () => {
  assert.deepEqual(downsample([1, 2, 3], 5), [1, 2, 3]);
  const d = downsample([1, 1, 3, 3, 5, 5], 3);
  assert.deepEqual(d, [1, 3, 5]);
  assert.equal(downsample(Array.from({ length: 100 }, (_, i) => i), 30).length, 30);
  assert.deepEqual(downsample([1, 2], 0), []);
});

test('hoursToLimit reproduces the measured projection and handles no growth', () => {
  const h = hoursToLimit({ freeGB: 121.8, keepFreeGB: 15, gbPerHour: 5.8 });
  assert.ok(h > 18 && h < 19, `${h}`);
  assert.equal(hoursToLimit({ freeGB: 121.8, gbPerHour: 0 }), null);
  assert.equal(hoursToLimit({ freeGB: 121.8, gbPerHour: -3 }), null);
  assert.equal(hoursToLimit({ freeGB: null, gbPerHour: 5 }), null);
  assert.equal(hoursToLimit({ freeGB: 10, keepFreeGB: 15, gbPerHour: 5 }), 0);
});

test('classifyClient: launching, ok, not in game, hung, disconnected', () => {
  const now = T0 + 10 * MIN;
  assert.equal(classifyClient({ inst: { startedAt: now - 30000 }, now }).state, 'launching');
  assert.equal(classifyClient({ inst: { startedAt: now - 5 * MIN, log: { inGame: true } }, now }).label, 'in game');
  assert.equal(classifyClient({ inst: { startedAt: now - 5 * MIN }, now }).label, 'running');
  assert.equal(classifyClient({ inst: { startedAt: now - 5 * MIN, log: { inGame: false } }, now }).state, 'degraded');
  assert.equal(classifyClient({ inst: { startedAt: now - 5 * MIN, hung: true }, now }).label, 'not responding');
  const dc = classifyClient({ inst: { startedAt: now - 5 * MIN, log: { inGame: false, disconnectedAt: now - 1000, reason: '267' } }, now });
  assert.equal(dc.state, 'failed');
  assert.match(dc.label, /disconnected \(267\)/);
  assert.equal(classifyClient({ inst: null, now }).state, 'degraded');
});

test('fleetSummary: healthy, watch and danger levels from commit and growth', () => {
  const s = new MetricsStore();
  const now = T0 + 40 * MIN;
  const keys = ['a', 'b'];
  for (const k of keys) feed(s, k, { minutes: 40, perMin: 14 });
  const inst = keys.map((key) => ({ key, privMB: 2600 }));
  const ok = fleetSummary({ instances: inst, store: s, memory: { freeBytes: 150 * GB, limitBytes: 191 * GB }, now });
  assert.equal(ok.clients, 2);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.trend.id, 'creeping');
  assert.ok(ok.hoursToLimit > 50 && ok.hoursToLimit < 120, String(ok.hoursToLimit));
  assert.ok(Math.abs(ok.totalPrivGB - 5200 / 1024) < 1e-9);
  assert.equal(fleetSummary({ instances: inst, store: s, memory: { freeBytes: 35 * GB, limitBytes: 191 * GB }, now }).level, 'watch');
  assert.equal(fleetSummary({ instances: inst, store: s, memory: { freeBytes: 18 * GB, limitBytes: 191 * GB }, now }).level, 'danger');
});

test('fleetSummary with no memory reading or no history still answers', () => {
  const r = fleetSummary({ instances: [{ key: 'x', privMB: 1500 }], store: new MetricsStore(), memory: null });
  assert.equal(r.freeGB, null);
  assert.equal(r.hoursToLimit, null);
  assert.equal(r.level, 'ok');
  assert.equal(r.trend.id, 'unknown');
  assert.equal(fleetSummary({ instances: [], store: null, memory: null }).clients, 0);
});
