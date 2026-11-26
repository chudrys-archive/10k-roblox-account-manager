'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitizePerf, effectivePerf } = require('../src/perf');

test('sanitizePerf keeps valid overrides and drops invalid ones', () => {
  assert.strictEqual(sanitizePerf(null), null);
  assert.strictEqual(sanitizePerf({}), null);
  assert.strictEqual(sanitizePerf({ fpsCap: 5, graphicsLevel: 11, windowWidth: 50, windowHeight: 50 }), null);
  assert.deepStrictEqual(sanitizePerf({ fpsCap: 60 }), { fpsCap: 60, graphicsLevel: 0, windowWidth: 0, windowHeight: 0 });
  assert.deepStrictEqual(sanitizePerf({ fpsCap: '30', graphicsLevel: '7', windowWidth: 1280, windowHeight: 720 }), { fpsCap: 30, graphicsLevel: 7, windowWidth: 1280, windowHeight: 720 });
  assert.deepStrictEqual(sanitizePerf({ fpsCap: 60, windowWidth: 1280 }), { fpsCap: 60, graphicsLevel: 0, windowWidth: 0, windowHeight: 0 }, 'a window size needs both sides');
  assert.strictEqual(sanitizePerf({ fpsCap: 361 }), null);
});

test('effectivePerf: account override wins field by field, the rest comes from the global setting', () => {
  const g = { fpsCap: 15, graphicsLevel: 1, windowWidth: 320, windowHeight: 240 };
  assert.deepStrictEqual(effectivePerf(g, null), g);
  assert.deepStrictEqual(effectivePerf(g, { fpsCap: 60 }), { fpsCap: 60, graphicsLevel: 1, windowWidth: 320, windowHeight: 240 });
  assert.deepStrictEqual(effectivePerf(g, { fpsCap: 60, graphicsLevel: 8, windowWidth: 1280, windowHeight: 720 }), { fpsCap: 60, graphicsLevel: 8, windowWidth: 1280, windowHeight: 720 });
  assert.deepStrictEqual(effectivePerf({}, { fpsCap: 30 }), { fpsCap: 30, graphicsLevel: 0, windowWidth: 0, windowHeight: 0 });
});
