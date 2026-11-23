'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-capture-'));
process.env.IRAM_DATA_DIR = dir;
const { CaptureGate } = require('../src/capture');
const { registerCapture, EXTENSION_ID } = require('../src/nativehost');

const COOKIE = 'c'.repeat(40);

test('capture: an armed wait takes one cookie, then the gate is idle again', async () => {
  const g = new CaptureGate();
  const w = g.arm({ label: 'x' });
  assert.equal(g.status().armed, true);
  assert.equal(g.status().label, 'x');
  assert.equal(g.offer(COOKIE), true);
  assert.equal(await w, COOKIE);
  assert.equal(g.armed(), false);
  assert.equal(g.offer(COOKIE), false, 'nothing is taken while idle');
});

test('capture: values that are not cookies are refused and the wait stays armed', async () => {
  const g = new CaptureGate();
  const w = g.arm();
  assert.equal(g.offer('short'), false);
  assert.equal(g.offer(undefined), false);
  assert.equal(g.armed(), true);
  g.cancel();
  await assert.rejects(w, /cancelled/);
});

test('capture: a wait with no cookie times out and clears', async () => {
  const g = new CaptureGate();
  const w = g.arm({ timeoutMs: 30 });
  await assert.rejects(w, /timed out/);
  assert.equal(g.armed(), false);
});

test('capture: arming again supersedes the old wait', async () => {
  const g = new CaptureGate();
  const first = g.arm();
  const second = g.arm({ label: 'two' });
  await assert.rejects(first, /superseded/);
  assert.equal(g.status().label, 'two');
  g.cancel();
  await assert.rejects(second, /cancelled/);
});

test('capture: the gate keeps no cookie after a take', async () => {
  const g = new CaptureGate();
  const w = g.arm();
  g.offer(COOKIE);
  await w;
  assert.equal(g.pending, null);
  assert.ok(!JSON.stringify(g).includes(COOKIE));
});

test('capture: connected() reflects the last status poll from the native host', () => {
  const g = new CaptureGate();
  assert.equal(g.connected(), false);
  g.touch();
  assert.equal(g.connected(), true);
});

test('capture: the extension id is a stable 32-letter id', () => {
  assert.match(EXTENSION_ID, /^[a-p]{32}$/);
});

test('capture: registration writes the host launcher and manifest with the extension id', async () => {
  const calls = [];
  const r = await registerCapture({
    dataDir: path.join(dir, 'data'),
    nodePath: 'C:\\node\\node.exe',
    regAdd: async (key, value) => { calls.push([key, value]); },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com\.isa\.roblox_manager$/);
  assert.equal(calls[0][1], r.manifestPath);
  const manifest = JSON.parse(fs.readFileSync(r.manifestPath, 'utf8'));
  assert.equal(manifest.type, 'stdio');
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  assert.ok(fs.existsSync(path.join(r.extDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(r.extDir, 'background.js')));
  const bat = fs.readFileSync(manifest.path, 'utf8');
  assert.match(bat, /IRAM_DATA_DIR=/);
  assert.match(bat, /C:\\node\\node\.exe/);
});