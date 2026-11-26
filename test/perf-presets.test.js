'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cpuShare } = require('../src/cpu');
const { PRESETS, matchPreset, diffPreset, byId } = require('../src/presets');
const { roomForMore } = require('../src/metrics');
const { Settings, DEFAULTS } = require('../src/settings');

test('cpuShare: first reading has no value, then a share of the whole machine', () => {
  let r = cpuShare(null, 1000, 10000, 16, null);
  assert.strictEqual(r.pct, null);
  // 800 ms of CPU in 2 s on 16 cores = 40% of one core = 2.5% of the machine
  r = cpuShare(r.prev, 1800, 12000, 16, r.pct);
  assert.strictEqual(r.pct, 2.5);
  // smoothing: next window shows 0 use, value halves
  r = cpuShare(r.prev, 1800, 14000, 16, r.pct);
  assert.strictEqual(r.pct, 1.3);
});

test('cpuShare: ignores unreadable values, tiny windows and restarted counters', () => {
  const prev = { ms: 5000, t: 1000 };
  assert.deepStrictEqual(cpuShare(prev, null, 3000, 8, 4), { pct: 4, prev });
  assert.deepStrictEqual(cpuShare(prev, NaN, 3000, 8, 4), { pct: 4, prev });
  assert.deepStrictEqual(cpuShare(prev, 5100, 1200, 8, 4), { pct: 4, prev });
  const reset = cpuShare(prev, 100, 5000, 8, 4);
  assert.strictEqual(reset.pct, 4);
  assert.deepStrictEqual(reset.prev, { ms: 100, t: 5000 });
  assert.strictEqual(cpuShare({ ms: 0, t: 0 }, 1e9, 1000, 4, null).pct, 100); // clamped
});

test('presets: every preset is a complete, valid settings patch and is recognised after applying', () => {
  for (const p of PRESETS) {
    const s = Object.create(Settings.prototype);
    s.data = JSON.parse(JSON.stringify(DEFAULTS));
    s.save = () => {};
    s.emit = () => {};
    s.update(p.settings);
    assert.strictEqual(matchPreset(s.data), p.id, `${p.id} survives the sanitizer unchanged`);
    assert.deepStrictEqual(diffPreset(s.data, p.id), []);
  }
});

test('presets: diff lists only what changes; unknown id and custom values are handled', () => {
  const cur = { ...byId('max').settings };
  const d = diffPreset(cur, 'default');
  assert.ok(d.length > 0 && d.every((x) => x.from !== x.to));
  assert.ok(d.find((x) => x.key === 'fpsCap' && x.from === 15 && x.to === 0));
  assert.deepStrictEqual(diffPreset(cur, 'nope'), []);
  assert.strictEqual(matchPreset({ ...cur, fpsCap: 17 }), 'custom');
  assert.strictEqual(matchPreset({}), 'custom');
});

test('roomForMore: how many more clients fit above the free-commit reserve', () => {
  assert.strictEqual(roomForMore({ freeGB: 100, keepFreeGB: 15, perClientGB: 3 }), Math.floor(85 / (3 * 1.15)));
  assert.strictEqual(roomForMore({ freeGB: 10, keepFreeGB: 15, perClientGB: 3 }), 0);
  assert.strictEqual(roomForMore({ freeGB: null, keepFreeGB: 15, perClientGB: 3 }), null);
  assert.strictEqual(roomForMore({ freeGB: 50, keepFreeGB: 15, perClientGB: null }), null);
  assert.strictEqual(roomForMore({ freeGB: 50, keepFreeGB: 15, perClientGB: 0 }), null);
});

test('gateRoom: the launch gate plan, minus the clients already running', () => {
  const { gateRoom } = require('../src/metrics');
  // 191 GB limit, 6 GB kept back, floor 8 GB (+15% = 9.2): 20 clients in total, one running -> 19 more
  assert.strictEqual(gateRoom({ limitGB: 191, keepGB: 6, running: 1, peakGB: 2.4, floorGB: 8 }), 19);
  // a client that has grown past the floor shrinks the plan: 12 GB x 1.15 = 13.8 -> 13 in total
  assert.strictEqual(gateRoom({ limitGB: 191, keepGB: 6, running: 4, peakGB: 12, floorGB: 8 }), 9);
  assert.strictEqual(gateRoom({ limitGB: 95, keepGB: 6, running: 30, peakGB: 9, floorGB: 8 }), 0);
  assert.strictEqual(gateRoom({ limitGB: null, keepGB: 6, running: 1, peakGB: 3, floorGB: 8 }), null);
  assert.strictEqual(gateRoom({ limitGB: 0, keepGB: 6, running: 1, peakGB: 3, floorGB: 8 }), null);
  assert.strictEqual(gateRoom({ limitGB: 100, keepGB: 6, running: 0, peakGB: null, floorGB: 8 }), Math.floor(94 / 9.2));
});
