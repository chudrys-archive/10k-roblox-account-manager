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