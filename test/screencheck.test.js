'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-sc-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { ScreenCheck, fpDistance, readDialog, trackFrame } = require('../src/screencheck');
const { Watchdog } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

const flat = (v) => v.toString(16).padStart(2, '0').repeat(144);

test('fingerprints: equal frames are 0 apart, different ones are far, bad input cannot be compared', () => {
  assert.equal(fpDistance(flat(100), flat(100)), 0);
  assert.equal(fpDistance(flat(100), flat(110)), 10);
  assert.equal(fpDistance(flat(100), 'zz'), Infinity);
  assert.equal(fpDistance(undefined, flat(1)), Infinity);
});

test('dialog text: errors are dialogs, bans are moderation, normal screens are neither', () => {
  assert.equal(readDialog('Disconnected You were kicked from the experience. (Error Code: 267)'), 'dialog');
  assert.equal(readDialog('Auth Error: invalid key'), 'dialog');
  assert.equal(readDialog('Your account has been terminated. Disconnected'), 'moderation');
  assert.equal(readDialog('Round 4 Leave Retry Modifiers'), null);
  assert.equal(readDialog(''), null);
});

test('the frozen timer restarts whenever the picture changes', () => {
  const tr = {};
  assert.equal(trackFrame(tr, flat(50), 1000), 0);
  assert.equal(trackFrame(tr, flat(50), 61000), 60000);
  assert.equal(trackFrame(tr, flat(90), 62000), 0);
});

function build({ results, wcfg = {} }) {
  const w = { ...DEFAULTS.watchdog, screenCheckSec: 60, frozenMin: 20, graceSec: 150, ...wcfg };
  const settings = { get: (k) => (k === 'watchdog' ? w : k ? DEFAULTS[k] : DEFAULTS) };
  const acc = { id: 'a1', userId: 1, username: 'alt1', status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5 } } };
  const accounts = { loaded: true, list: [acc], get: () => acc, session: () => ({}), save() {} };
  const launcher = new EventEmitter();
  launcher.pending = new Map();
  launcher.kills = [];
  launcher.instances = new Map([[100, { pid: 100, accountId: 'a1', startedAt: Date.now() - 3600e3 }]]);
  launcher.byAccount = () => [...launcher.instances.values()];
  launcher.kill = async (pids, why) => { for (const p of pids) launcher.instances.delete(p); launcher.kills.push(why); };
  const watchdog = new Watchdog({ launcher, accounts, settings });
  const sc = new ScreenCheck({ launcher, accounts, settings, watchdog, run: async () => results.shift() });
  return { sc, launcher, acc };
}

const ok = (fp, text = '') => [{ pid: 100, ok: true, fp, text }];

test('a picture that stays the same for the frozen limit restarts the client', async () => {
  const t0 = Date.now();
  const { sc, launcher } = build({ results: [ok(flat(80)), ok(flat(80)), ok(flat(80))] });
  assert.deepEqual(await sc.runOnce(t0), []);
  assert.deepEqual(await sc.runOnce(t0 + 10 * 60e3), []);
  const issues = await sc.runOnce(t0 + 21 * 60e3);
  assert.equal(issues[0].kind, 'frozen');
  assert.match(launcher.kills[0], /screen frozen for 21 min/);
});

test('a moving picture is never restarted', async () => {
  const t0 = Date.now();
  const { sc, launcher } = build({ results: [ok(flat(10)), ok(flat(60)), ok(flat(120)), ok(flat(30))] });
  for (let i = 0; i < 4; i++) await sc.runOnce(t0 + i * 10 * 60e3);
  assert.equal(launcher.kills.length, 0);
});

test('an error dialog must be seen twice in a row before the client is restarted', async () => {
  const t0 = Date.now();
  const { sc, launcher } = build({ results: [ok(flat(1), 'Disconnected Error Code: 277'), ok(flat(2), 'Disconnected Error Code: 277')] });
  await sc.runOnce(t0);
  assert.equal(launcher.kills.length, 0);
  const issues = await sc.runOnce(t0 + 60e3);
  assert.equal(issues[0].kind, 'dialog');
  assert.equal(launcher.kills.length, 1);
});

test('one clean look in between resets the dialog count', async () => {
  const t0 = Date.now();
  const { sc, launcher } = build({ results: [ok(flat(1), 'Disconnected'), ok(flat(2), 'Round 5'), ok(flat(3), 'Disconnected')] });
  for (let i = 0; i < 3; i++) await sc.runOnce(t0 + i * 60e3);
  assert.equal(launcher.kills.length, 0);
});

test('a moderation message is reported and the client is left open', async () => {
  const { sc, launcher } = build({ results: [ok(flat(1), 'Your account has been terminated')] });
  const issues = await sc.runOnce();
  assert.equal(issues[0].kind, 'moderation');
  assert.equal(launcher.kills.length, 0);
});

test('covered or unreadable windows are not judged, and the check does nothing while off', async () => {
  const t0 = Date.now();
  const covered = build({ results: [[{ pid: 100, covered: true, ok: false }], [{ pid: 100, covered: true, ok: false }]] });
  await covered.sc.runOnce(t0);
  await covered.sc.runOnce(t0 + 60 * 60e3);
  assert.equal(covered.launcher.kills.length, 0);
  const off = build({ results: [ok(flat(1), 'Disconnected')], wcfg: { screenCheckSec: 0 } });
  assert.deepEqual(await off.sc.runOnce(), []);
});

test('a client that only just started is not looked at yet', async () => {
  const { sc, launcher } = build({ results: [ok(flat(1), 'Disconnected')] });
  launcher.instances.get(100).startedAt = Date.now() - 30e3;
  assert.deepEqual(await sc.runOnce(), []);
});
