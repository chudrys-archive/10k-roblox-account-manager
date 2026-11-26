'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-sse-'));

const test = require('node:test');
const assert = require('node:assert');
const { Server } = require('../src/server');

function fakeClient(writableLength) {
  const c = { writableLength, written: [], destroyed: false };
  c.write = (m) => { c.written.push(m); return true; };
  c.destroy = () => { c.destroyed = true; };
  return c;
}

test('broadcast drops a viewer whose queue grew past 4 MB and keeps the others', () => {
  const s = Object.create(Server.prototype);
  const slow = fakeClient(5 * 1024 * 1024);
  const ok = fakeClient(10);
  s.clients = new Set([slow, ok]);
  s.broadcast('state', { a: 1 });
  assert.strictEqual(slow.destroyed, true);
  assert.strictEqual(slow.written.length, 0, 'nothing more is queued for the slow viewer');
  assert.strictEqual(s.clients.has(slow), false);
  assert.strictEqual(ok.written.length, 1);
  assert.match(ok.written[0], /^event: state\ndata: \{"a":1\}\n\n$/);
  assert.strictEqual(s.clients.has(ok), true);
});

test('broadcast removes a viewer whose write throws, without stopping the others', () => {
  const s = Object.create(Server.prototype);
  const broken = fakeClient(0);
  broken.write = () => { throw new Error('socket closed'); };
  const ok = fakeClient(0);
  s.clients = new Set([broken, ok]);
  s.broadcast('log', { m: 'x' });
  assert.strictEqual(s.clients.has(broken), false);
  assert.strictEqual(ok.written.length, 1);
});
