'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-login-'));
process.env.IRAM_DATA_DIR = dir;

const test = require('node:test');
const assert = require('node:assert/strict');
const { Settings } = require('../src/settings');
const { BrowserManager } = require('../src/browser');
const { CaptureGate } = require('../src/capture');
const appWindow = require('../src/appwindow');

test('the sign-in window defaults to the built-in one and only accepts known values', () => {
  const s = new Settings();
  assert.equal(s.get('loginWindow'), 'app');
  s.update({ loginWindow: 'browser' });
  assert.equal(s.get('loginWindow'), 'browser');
  s.update({ loginWindow: 'something else' });
  assert.equal(s.get('loginWindow'), 'app');
});

test('the browser is used for sign-in when it is chosen in Settings', () => {
  const s = new Settings();
  const b = new BrowserManager({ settings: s, accounts: {}, capture: new CaptureGate() });
  s.update({ loginWindow: 'browser' });
  assert.equal(b.plannedVia(), 'browser');
  s.update({ loginWindow: 'app' });
  assert.equal(b.plannedVia(), appWindow.hostState() === 'unsupported' ? 'browser' : 'app');
});

test('the extension only matters when the last login went through the browser', () => {
  const s = new Settings();
  const b = new BrowserManager({ settings: s, accounts: {}, capture: new CaptureGate() });
  b.lastVia = 'app';
  assert.equal(b.needsExtension(), false);
  b.lastVia = 'browser';
  assert.equal(b.needsExtension(), true);
});

test('cancelling a waiting login rejects it and frees the gate for the next one', async () => {
  const gate = new CaptureGate();
  const wait = gate.arm({ label: 'quick login', qr: true });
  const failed = assert.rejects(wait, /cancelled/i);
  assert.equal(gate.cancel('cancelled'), true);
  await failed;
  assert.equal(gate.armed(), false);
  assert.equal(gate.cancel('cancelled'), false);
});

test('the sign-in window exists as a function and talks to the capture channel', () => {
  assert.ok(typeof appWindow.openLogin === 'function');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'tools', 'LoginWindow.cs'), 'utf8').includes('/capture/offer'));
});
