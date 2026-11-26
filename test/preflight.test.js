'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('../src/preflight');

const ids = (r) => r.map((x) => x.id);

test('a clean setup has nothing to report', () => {
  assert.deepEqual(preflight({ settings: { watchdog: { enabled: true }, graphicsApi: 'auto' }, facts: { roblox: { path: 'x' }, accounts: [], multiInstance: true } }), []);
});

test('flags a missing Roblox, bad FFlags JSON and risky graphics APIs, errors first', () => {
  const r = preflight({ settings: { customFFlags: '[1,2]', graphicsApi: 'vulkan' }, facts: { roblox: null, multiInstance: true } });
  assert.deepEqual(ids(r), ['roblox-missing', 'fflags-invalid', 'graphics-api']);
  assert.equal(r[0].level, 'error');
});

test('flags keep-alive on invalid accounts, a build change, single-instance mode and paused watchdog', () => {
  const r = preflight({
    settings: { watchdog: { enabled: false } },
    facts: { roblox: {}, multiInstance: false, build: { changed: true, previous: '0.747.0.1', current: '0.748.0.2' }, accounts: [{ username: 'a', status: 'banned', keepAlive: { enabled: true } }, { username: 'b', status: 'valid', keepAlive: { enabled: true } }] },
  });
  assert.deepEqual(ids(r), ['build-changed', 'keepalive-invalid', 'single-instance', 'watchdog-off']);
  assert.match(r[1].text, /a/);
});

test('valid FFlags JSON object is accepted', () => {
  assert.deepEqual(ids(preflight({ settings: { customFFlags: '{"A":"1"}' }, facts: { roblox: {}, multiInstance: true } })), []);
});
