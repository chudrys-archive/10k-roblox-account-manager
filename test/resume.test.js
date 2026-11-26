'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-resume-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Watchdog, planResume } = require('../src/watchdog');
const { DEFAULTS } = require('../src/settings');

const mk = (id, extra = {}) => ({ id, userId: Number(id.replace(/\D/g, '')) || 1, username: id, status: 'valid', keepAlive: { enabled: true, target: { type: 'game', placeId: 5, label: '5' } }, ...extra });

test('planResume: only enabled, usable accounts from a fresh list, spread out one by one', () => {
  const now = 1_000_000;
  const accounts = [mk('a'), mk('b'), mk('c', { status: 'banned' }), mk('d', { keepAlive: { enabled: false, target: null } }), mk('e', { status: 'verify' }), mk('f')];
  const saved = { at: now - 60e3, accounts: ['a', 'b', 'c', 'd', 'e', 'f', 'gone', 'a', 7] };
  const plan = planResume({ saved, accounts, now, launchDelayMs: 6000, rand: () => 0 });
  assert.deepEqual(plan.map((p) => p.id), ['a', 'b', 'f'], 'banned, verifying, switched-off, unknown, duplicate and malformed entries are dropped');
  assert.equal(plan[0].at, now + 20e3, 'nothing starts in the first seconds');
  assert.equal(plan[1].at - plan[0].at, 6000);
  assert.equal(plan[2].at - plan[1].at, 6000);
  const spread = planResume({ saved, accounts, now, launchDelayMs: 6000, rand: () => 1 });
  assert.equal(spread[1].at - spread[0].at, 11000, 'plus a random few seconds');
});

test('planResume: stale, future, empty or broken lists resume nothing', () => {
  const now = 50e6;
  const accounts = [mk('a')];
  assert.deepEqual(planResume({ saved: { at: now - 13 * 3600e3, accounts: ['a'] }, accounts, now }), [], 'older than 12 hours');
  assert.deepEqual(planResume({ saved: { at: now + 10 * 60e3, accounts: ['a'] }, accounts, now }), [], 'a clock that jumped');
  assert.deepEqual(planResume({ saved: { at: now, accounts: [] }, accounts, now }), []);
  assert.deepEqual(planResume({ saved: null, accounts, now }), []);
  assert.deepEqual(planResume({ saved: { at: 'x', accounts: ['a'] }, accounts, now }), []);
  assert.deepEqual(planResume({ saved: { at: now, accounts: 'a' }, accounts, now }), []);
});

function setup({ file, settings = DEFAULTS, accounts = [mk('a1'), mk('a2')] } = {}) {
  const resumeFile = file || path.join(process.env.IRAM_DATA_DIR, 'r-' + Math.random().toString(36).slice(2) + '.json');
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  launcher.pending = new Map();
  launcher.launches = [];
  launcher.held = new Set();
  launcher.isHeld = (id) => launcher.held.has(id);
  launcher.byAccount = (id) => [...launcher.instances.values()].filter((i) => i.accountId === id);
  launcher.launch = async (id) => { launcher.launches.push(id); launcher.instances.set(100 + launcher.launches.length, { pid: 100 + launcher.launches.length, accountId: id, startedAt: Date.now() }); };
  launcher.kill = async () => {};
  const store = { loaded: true, list: accounts, get: (id) => accounts.find((a) => a.id === id) || null, session: () => ({}) };
  const wd = new Watchdog({ launcher, accounts: store, settings: { get: (k) => (k ? settings[k] : settings) }, resumeFile });
  wd.resumeOn = true; // what start() does, without the timers
  return { wd, launcher, resumeFile, accounts };
}

test('a restart brings back the accounts that were running, one at a time, and leaves the others alone', async () => {
  const file = path.join(process.env.IRAM_DATA_DIR, 'restart.json');
  fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 30e3, accounts: ['a1'] }));
  const { wd, launcher } = setup({ file });
  await wd.tick();
  assert.equal(launcher.launches.length, 0, 'not in the first seconds: clients that are still open must be adopted first');
  assert.equal(wd.st('a1').status, 'waiting');
  assert.match(wd.st('a1').msg, /resuming after a restart/);
  assert.equal(wd.st('a2').status, 'idle', 'an account that was not running is not started');

  wd.st('a1').nextAttemptAt = Date.now() - 1; // the grace period is over
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(launcher.launches, ['a1']);
});

test('a client that is still open after the restart is not launched a second time', async () => {
  const file = path.join(process.env.IRAM_DATA_DIR, 'adopted.json');
  fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 30e3, accounts: ['a1'] }));
  const { wd, launcher } = setup({ file });
  launcher.instances.set(7, { pid: 7, accountId: 'a1', startedAt: Date.now() - 5 * 60e3 });
  await wd.tick();
  assert.equal(launcher.launches.length, 0);
  assert.equal(wd.st('a1').status, 'running');
  assert.equal(wd.st('a1').nextAttemptAt, 0, 'no stale start time is left behind');
});

test('the setting turns resume off', async () => {
  const file = path.join(process.env.IRAM_DATA_DIR, 'off.json');
  fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 30e3, accounts: ['a1'] }));
  const settings = { ...DEFAULTS, watchdog: { ...DEFAULTS.watchdog, resumeAfterRestart: false } };
  const { wd, launcher } = setup({ file, settings });
  await wd.tick();
  wd.st('a1').nextAttemptAt = Date.now() - 1;
  await wd.tick();
  assert.equal(launcher.launches.length, 0);
  assert.equal(wd.st('a1').status, 'idle');
});

test('running accounts are written to the list; accounts stopped on purpose are not', async () => {
  const { wd, launcher, resumeFile } = setup();
  launcher.instances.set(7, { pid: 7, accountId: 'a1', startedAt: Date.now() - 60e3 });
  launcher.instances.set(8, { pid: 8, accountId: 'a2', startedAt: Date.now() - 60e3 });
  await wd.tick();
  let saved = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
  assert.deepEqual(saved.accounts, ['a1', 'a2']);

  // "Close all": the accounts are held and their clients are gone
  launcher.instances.clear();
  launcher.held.add('a1'); launcher.held.add('a2');
  await wd.tick();
  assert.equal(wd.st('a1').armed, false);
  saved = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
  assert.deepEqual(saved.accounts, [], 'a restart must not bring back what the person closed');

  // even after the hold runs out, nothing is relaunched by itself
  launcher.held.clear();
  await wd.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(launcher.launches.length, 0);
  assert.equal(wd.st('a1').status, 'idle');
});

test('quitting with "close the clients" clears the list; quitting and leaving them open keeps it', async () => {
  const a = setup();
  a.launcher.instances.set(7, { pid: 7, accountId: 'a1', startedAt: Date.now() - 60e3 });
  await a.wd.tick();
  a.wd.stop();
  assert.deepEqual(JSON.parse(fs.readFileSync(a.resumeFile, 'utf8')).accounts, ['a1'], 'clients stay open, so the list stays');

  const b = setup();
  b.launcher.instances.set(7, { pid: 7, accountId: 'a1', startedAt: Date.now() - 60e3 });
  await b.wd.tick();
  b.wd.stop({ clearResume: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(b.resumeFile, 'utf8')).accounts, []);
  await b.wd.tick();
  assert.deepEqual(JSON.parse(fs.readFileSync(b.resumeFile, 'utf8')).accounts, [], 'a tick after stop does not write it back');
});
