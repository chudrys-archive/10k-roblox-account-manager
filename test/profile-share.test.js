'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encodeProfile, decodeProfile, sanitize } = require('../src/profiles');
const { validateDue } = require('../src/cookiecheck');

test('a profile code round-trips name and values', () => {
  const values = { fastProfile: 'lowest', fpsCap: 15, graphicsLevel: 1, clientPriority: 'BelowNormal', minimizedAction: 'park' };
  const code = encodeProfile('AFK farm', values);
  assert.ok(code.startsWith('IRAM1:'));
  const d = decodeProfile(code);
  assert.equal(d.name, 'AFK farm');
  assert.deepEqual(d.values, values);
  assert.deepEqual(d.rejected, []);
});

test('encoding drops keys that are not whitelisted run settings', () => {
  const code = encodeProfile('x', { fpsCap: 30, alerts: { webhook: 'https://secret' }, cookie: 'abc' });
  const d = decodeProfile(code);
  assert.deepEqual(d.values, { fpsCap: 30 });
  assert.ok(!Buffer.from(code.slice(6), 'base64url').toString().includes('secret'));
});

test('decoding refuses codes that are not profile codes or are damaged', () => {
  assert.throws(() => decodeProfile('hello'), /not a profile code/);
  assert.throws(() => decodeProfile('IRAM1:%%%%'), /damaged/);
  assert.throws(() => decodeProfile('IRAM1:' + Buffer.from('[]').toString('base64url')), /damaged/);
  assert.throws(() => decodeProfile('IRAM1:' + 'A'.repeat(3000)), /too long/);
  assert.throws(() => decodeProfile('IRAM1:' + Buffer.from(JSON.stringify({ n: 'a', v: {} })).toString('base64url')), /no usable settings/);
});

test('decoding drops invalid values from a hand-made code and reports them', () => {
  const body = { n: 'evil', v: { fpsCap: 60, clientPriority: 'RealTime', graphicsApi: 'dx9', fastProfile: 'low' } };
  const d = decodeProfile('IRAM1:' + Buffer.from(JSON.stringify(body)).toString('base64url'));
  assert.deepEqual(d.values, { fpsCap: 60, fastProfile: 'low' });
  assert.deepEqual(d.rejected.sort(), ['clientPriority', 'graphicsApi']);
  assert.deepEqual(sanitize(d.values).rejected, []);
});

test('validateDue: off at 0, due only after the interval', () => {
  const H = 3600e3;
  assert.equal(validateDue(0, 100 * H, 0), false);
  assert.equal(validateDue(0, 100 * H, undefined), false);
  assert.equal(validateDue(0, 5 * H, 6), false);
  assert.equal(validateDue(0, 6 * H, 6), true);
  assert.equal(validateDue(10 * H, 30 * H, 24), false);
  assert.equal(validateDue(10 * H, 34 * H, 24), true);
  assert.equal(validateDue(NaN, 34 * H, 24), false);
});

test('cookie checker: off, not due, started, busy, error handling', async () => {
  const { createCookieChecker } = require('../src/cookiecheck');
  const H = 3600e3;
  let clock = 1000 * H;
  let hours = 0;
  let calls = 0;
  let release;
  let fail = false;
  const logs = [];
  const accounts = { loaded: true, list: [{ id: 'a' }], validateMany: () => { calls++; if (fail) return Promise.reject(new Error('network down')); return new Promise((r) => { release = r; }); } };
  const settings = { get: (k) => (k === 'validateEveryHours' ? hours : undefined) };
  const log = { info: (m) => logs.push('i:' + m), warn: (m) => logs.push('w:' + m), debug() {} };
  const c = createCookieChecker({ accounts, settings, log, now: () => clock });
  assert.equal(c.tick(), 'off');
  hours = 6;
  assert.equal(c.tick(), 'not-due');
  clock += 5 * H; assert.equal(c.tick(), 'not-due');
  clock += 1 * H; assert.equal(c.tick(), 'started');
  assert.equal(calls, 1);
  clock += 1 * H; assert.equal(c.tick(), 'busy', 'never overlaps a running check');
  release(); await new Promise((r) => setImmediate(r));
  assert.equal(c.tick(), 'not-due', 'interval restarts from the last run');
  clock += 6 * H; fail = true;
  assert.equal(c.tick(), 'started');
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.ok(logs.some((l) => l.startsWith('w:') && /network down/.test(l)));
  clock += 6 * H; fail = false;
  assert.equal(c.tick(), 'started', 'a failed check does not block the next one');
  release();
  accounts.loaded = false; assert.equal(c.tick(), 'empty');
  accounts.loaded = true; accounts.list = []; assert.equal(c.tick(), 'empty');
});
