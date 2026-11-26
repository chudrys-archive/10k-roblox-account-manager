'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScript, parseOutput, diffSnapshots, collect } = require('../src/snapshot');

test('buildScript accepts only positive integer pids', () => {
  const s = buildScript([123, '456', -1, 0, 1.5, 'x; calc', NaN, 2 ** 40]);
  assert.match(s, /\$ids = @\(123,456,1\)/);
  assert.doesNotMatch(s, /calc/);
});

test('parseOutput handles one object, an array, and garbage', () => {
  assert.deepEqual(parseOutput('{"pid":1,"privateMB":2}').map((x) => x.pid), [1]);
  assert.equal(parseOutput('[{"pid":1},{"pid":2}]').length, 2);
  assert.deepEqual(parseOutput('not json'), []);
  assert.deepEqual(parseOutput('[{"x":1}]'), []);
});

test('diffSnapshots reports change and per-minute rate for pids in both', () => {
  const a = { at: 0, rows: [{ pid: 1, workingSetMB: 100, privateMB: 200, virtualMB: 1, pagedPoolKB: 1, nonPagedPoolKB: 1, handles: 500, threads: 40, gdi: 10, user: 5 }, { pid: 2, workingSetMB: 1, privateMB: 1, virtualMB: 1, pagedPoolKB: 1, nonPagedPoolKB: 1, handles: 1, threads: 1, gdi: 1, user: 1 }] };
  const b = { at: 10 * 60e3, rows: [{ pid: 1, workingSetMB: 110, privateMB: 300, virtualMB: 1, pagedPoolKB: 1, nonPagedPoolKB: 1, handles: 600, threads: 40, gdi: 10, user: 5 }, { pid: 3, workingSetMB: 1, privateMB: 1, virtualMB: 1, pagedPoolKB: 1, nonPagedPoolKB: 1, handles: 1, threads: 1, gdi: 1, user: 1 }] };
  const d = diffSnapshots(a, b);
  assert.equal(d.length, 1);
  assert.equal(d[0].privateMB, 100); assert.equal(d[0].privateMBPerMin, 10); assert.equal(d[0].handlesPerMin, 10); assert.equal(d[0].threads, 0);
});

test('collect uses the injected runner and survives errors and empty input', async () => {
  const ok = await collect([5], { run: (f, args, o, cb) => cb(null, '[{"pid":5,"privateMB":1}]') });
  assert.equal(ok.rows[0].pid, 5);
  const bad = await collect([5], { run: (f, args, o, cb) => cb(new Error('boom'), '') });
  assert.deepEqual(bad.rows, []); assert.equal(bad.error, 'boom');
  assert.deepEqual((await collect([])).rows, []);
});
