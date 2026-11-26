'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScript, parseOutput, diffMaps, collect } = require('../src/vmmap');

test('the script is built only for whole positive process ids', () => {
  const s = buildScript([4, '12', 0, -3, 1.5, 'x; calc', 3e10]);
  assert.match(s, /\$ids = @\(4,12,1\)/);
  assert.ok(!/calc/.test(s));
});

test('output is parsed, access-denied rows are kept and garbage gives nothing', () => {
  const rows = parseOutput('[{"pid":5,"privateMB":10.5,"regions":3},{"pid":6,"error":"access denied"}]');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].error, 'access denied');
  assert.deepEqual(parseOutput('not json'), []);
});

test('change per minute is worked out only for clients present in both maps', () => {
  const a = { at: 0, rows: [{ pid: 1, privateMB: 100, readWriteMB: 80, execWriteMB: 0, readOnlyMB: 10, imageMB: 50, mappedMB: 5, reservedMB: 1000, regions: 100, largestPrivateMB: 20 }, { pid: 2, error: 'access denied' }] };
  const b = { at: 120e3, rows: [{ pid: 1, privateMB: 160, readWriteMB: 140, execWriteMB: 0, readOnlyMB: 10, imageMB: 50, mappedMB: 5, reservedMB: 1000, regions: 140, largestPrivateMB: 20 }, { pid: 3, privateMB: 1 }] };
  const d = diffMaps(a, b);
  assert.equal(d.length, 1);
  assert.equal(d[0].pid, 1);
  assert.equal(d[0].minutes, 2);
  assert.equal(d[0].privateMBPerMin, 30);
  assert.equal(d[0].regionsPerMin, 20);
});

test('collect uses the injected runner, survives a failure and skips an empty list', async () => {
  const ok = await collect([7], { run: (f, a, o, cb) => cb(null, '[{"pid":7,"privateMB":1}]') });
  assert.equal(ok.rows[0].pid, 7);
  const bad = await collect([7], { run: (f, a, o, cb) => cb(new Error('boom'), '') });
  assert.deepEqual(bad.rows, []);
  assert.equal(bad.error, 'boom');
  assert.deepEqual((await collect([], { run: () => { throw new Error('not called'); } })).rows, []);
});
