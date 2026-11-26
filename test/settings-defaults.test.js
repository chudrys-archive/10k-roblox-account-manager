'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-set-'));
process.env.IRAM_DATA_DIR = dir;

const test = require('node:test');
const assert = require('node:assert');
const { Settings, DEFAULTS } = require('../src/settings');

const FILE = path.join(dir, 'settings.json');

test('an install saved before the safe defaults gets them once, and keeps everything else', () => {
  fs.writeFileSync(FILE, JSON.stringify({
    antiAfk: { enabled: true, intervalMin: 12 },
    watchdog: { killHungAfterSec: 120, restartEveryMin: 30 },
    fastProfile: 'lowest', fpsCap: 60, customFFlags: '{"DFIntX":1}', clientPriority: 'Idle',
    trimMemoryMin: 5, neverUpdateRoblox: true, onAlreadyRunning: 'replace',
    alerts: { webhook: 'https://discord.com/api/webhooks/1/abc' }, favorites: [{ name: 'keep me', input: 'x' }],
  }));
  const s = new Settings();
  const d = s.get();
  assert.equal(d.antiAfk.enabled, false);
  assert.equal(d.antiAfk.intervalMin, 12, 'other anti-AFK values are kept');
  assert.equal(d.watchdog.killHungAfterSec, 0);
  assert.equal(d.watchdog.restartEveryMin, 0);
  assert.equal(d.fastProfile, 'off');
  assert.equal(d.fpsCap, 0);
  assert.equal(d.customFFlags, '');
  assert.equal(d.clientPriority, 'Normal');
  assert.equal(d.trimMemoryMin, 0);
  assert.equal(d.neverUpdateRoblox, false);
  assert.equal(d.onAlreadyRunning, 'skip');
  assert.equal(d.alerts.webhook, 'https://discord.com/api/webhooks/1/abc', 'alerts are kept');
  assert.equal(d.favorites[0].name, 'keep me', 'favorites are kept');
  assert.equal(d.settingsVersion, 2);
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.equal(onDisk.settingsVersion, 2, 'migration is written to disk');
  assert.equal(DEFAULTS.antiAfk.enabled, false, 'DEFAULTS is not mutated by the migration');
});

test('an install already on the current version keeps the choices the user made', () => {
  fs.writeFileSync(FILE, JSON.stringify({ settingsVersion: 2, antiAfk: { enabled: true }, fastProfile: 'low' }));
  const d = new Settings().get();
  assert.equal(d.antiAfk.enabled, true);
  assert.equal(d.fastProfile, 'low');
});

test('a fresh install starts on the safe defaults', () => {
  fs.rmSync(FILE, { force: true });
  const d = new Settings().get();
  assert.equal(d.antiAfk.enabled, false);
  assert.equal(d.watchdog.killHungAfterSec, 0);
  assert.equal(d.onAlreadyRunning, 'skip');
  assert.equal(d.settingsVersion, 2);
});

test('a fresh install is set up for several clients plus an executor', () => {
  const d = new Settings().get();
  assert.equal(d.multiInstance, true);
  assert.equal(d.onAlreadyRunning, 'skip');   // replacing would also close an executor running in that client
  assert.equal(d.executor.enabled, true);
  assert.equal(d.executor.openBeforeClients, true);
  assert.equal(d.executor.path, '');          // nothing is guessed: the path is filled in once an executor is seen running
  assert.equal(d.watchdog.killHungAfterSec, 0); // a force-kill would also close the executor
});

test('a fresh install runs clients small, slow and plain for idle use', () => {
  fs.rmSync(FILE, { force: true });
  const d = new Settings().get();
  assert.equal(d.fastProfile, 'lowest');
  assert.equal(d.fpsCap, 15);
  assert.equal(d.graphicsLevel, 1);
  assert.equal(d.windowWidth, 320);
  assert.equal(d.windowHeight, 240);
});

test('a window size below Roblox\'s own minimum is kept, but only down to the manager\'s floor and only as a pair', () => {
  const s = new Settings();
  s.update({ windowWidth: 200, windowHeight: 150 });
  assert.equal(s.get('windowWidth'), 200);
  s.update({ windowWidth: 100, windowHeight: 150 });
  assert.deepEqual([s.get('windowWidth'), s.get('windowHeight')], [0, 0]);
  s.update({ windowWidth: 320, windowHeight: 0 });
  assert.deepEqual([s.get('windowWidth'), s.get('windowHeight')], [0, 0]);
});
