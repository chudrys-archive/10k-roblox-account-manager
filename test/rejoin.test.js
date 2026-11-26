'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-rejoin-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Watchdog, rejoinDelay } = require('../src/watchdog');
const { isChallenge } = require('../src/roblox');
const { DEFAULTS } = require('../src/settings');

const w = { ...DEFAULTS.watchdog, relaunchDelaySec: 15 };
const mid = () => 0.375; // jitter factor 0.85 + 0.375 * 0.4 = 1.0

test('rejoins back off: quick first, then doubling, capped at 10 minutes', () => {
  const now = 1e9;
  const s = (n) => ({ launches: Array.from({ length: n }, (_, i) => now - i * 60e3) });
  assert.equal(rejoinDelay(s(0), w, now, mid), 15000);
  assert.equal(rejoinDelay(s(1), w, now, mid), 15000);
  assert.equal(rejoinDelay(s(2), w, now, mid), 30000);
  assert.equal(rejoinDelay(s(4), w, now, mid), 120000);
  assert.equal(rejoinDelay(s(12), w, now, mid), 600000, 'never more than 10 minutes');
  const old = { launches: [now - 40 * 60e3, now - 50 * 60e3] };
  assert.equal(rejoinDelay(old, w, now, mid), 15000, 'launches older than 30 min no longer count');
});

test('rejoin delay is spread randomly so accounts do not rejoin in lockstep', () => {
  const s = { launches: [] };
  assert.equal(rejoinDelay(s, w, 0, () => 0), 12750);
  assert.equal(rejoinDelay(s, w, 0, () => 1), 18750);
});

test('a verification challenge on the ticket request is recognised', () => {
  const res = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null } });
  assert.equal(isChallenge(res(403, { 'rblx-challenge-id': 'abc' })), true);
  assert.equal(isChallenge(res(403), '{"errors":[{"message":"Challenge is required to authorize the request"}]}'), true);
  assert.equal(isChallenge(res(401), 'Unauthorized'), false);
  assert.equal(isChallenge(res(500), ''), false);
});

test('keep-alive stops retrying for 30 minutes when Roblox asks for verification', async () => {
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5, label: '5' } } };
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  launcher.pending = new Map();
  let calls = 0;
  launcher.byAccount = () => [];
  launcher.launch = async () => { calls++; const e = new Error('verify'); e.verification = true; throw e; };
  const sent = [];
  const wd = new Watchdog({
    launcher, settings: { get: (k) => (k ? DEFAULTS[k] : DEFAULTS) },
    accounts: { loaded: true, list: [acc], get: () => acc, session: () => ({}) },
    alerts: { send: (...a) => sent.push(a) },
  });
  wd.st('a1').armed = true; // a client of this account was open
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  const s = wd.st('a1');
  assert.equal(calls, 1);
  assert.ok(s.nextAttemptAt - Date.now() > 29 * 60e3, 'waits ~30 minutes');
  assert.equal(s.status, 'error');
  assert.match(s.msg, /verification/);
  assert.equal(s.failures, 0, 'not counted as an ordinary failure');
  assert.equal(sent.length, 1);
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1, 'no second attempt while paused');
});
