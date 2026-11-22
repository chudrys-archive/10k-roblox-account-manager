'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-guard-'));

const test = require('node:test');
const assert = require('node:assert');
const { CaptchaGuard } = require('../src/captchaguard');
const { AccountStore } = require('../src/accounts');
const { Launcher } = require('../src/launcher');
const { Settings, DEFAULTS } = require('../src/settings');

const acc = { id: 'a1', username: 'alt1' };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iram-gf-')), 'guard.json');
function settingsWith(over = {}) {
  const cfg = { ...DEFAULTS.captchaGuard, ...over };
  return { get: (k) => (k === 'captchaGuard' ? cfg : DEFAULTS[k]) };
}
function store() {
  const s = new AccountStore({ data: { accounts: [{ id: 'a1', userId: 7, username: 'alt', cookie: 'x'.repeat(120), status: 'valid', keepAlive: { enabled: true } }] }, save() {}, locked: false });
  s.load();
  return s;
}

test('a captcha pauses automatic launches for everyone, but not the person\'s own actions', () => {
  const g = new CaptchaGuard({ settings: settingsWith(), file: tmpFile() });
  assert.equal(g.trip(acc, 'sign-in ticket'), true);
  assert.equal(g.trip(acc, 'again'), false, 'only the pause that starts returns true (one alert)');
  assert.equal(g.blocks('keep-alive'), true);
  assert.equal(g.blocks('api'), true);
  assert.equal(g.blocks('manual'), false);
  assert.equal(g.blocks('restart'), false);
  assert.equal(g.publicView().account, 'alt1');
  assert.equal(g.resume(), true);
  assert.equal(g.blocks('keep-alive'), false);
  assert.equal(g.resume(), false, 'resuming twice is harmless');
  g.stop();
});

test('the guard does nothing when it is switched off, or when pauseAll is off', () => {
  const off = new CaptchaGuard({ settings: settingsWith({ enabled: false }), file: tmpFile() });
  assert.equal(off.trip(acc, 'x'), false);
  assert.equal(off.paused, false);
  const one = new CaptchaGuard({ settings: settingsWith({ pauseAll: false }), file: tmpFile() });
  assert.equal(one.trip(acc, 'x'), false, 'per-account lockdown still happens elsewhere');
  assert.equal(one.paused, false);
  off.stop(); one.stop();
});

test('the pause is saved, so restarting the manager does not silently resume automation', () => {
  const file = tmpFile();
  const a = new CaptchaGuard({ settings: settingsWith(), file });
  a.trip(acc, 'client');
  a.stop();
  const b = new CaptchaGuard({ settings: settingsWith(), file });
  assert.equal(b.paused, true);
  b.resume();
  b.stop();
  const c = new CaptchaGuard({ settings: settingsWith(), file });
  assert.equal(c.paused, false);
  c.stop();
});

test('auto-resume lifts the pause once the time is up', async () => {
  const g = new CaptchaGuard({ settings: settingsWith({ autoResumeMin: 1 }), file: tmpFile() });
  g.trip(acc, 'x');
  assert.ok(g.state.resumeAt - Date.now() > 59e3, 'resumes after about a minute');
  g.state.resumeAt = Date.now() + 20; // shorten the wait for the test
  g.schedule();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(g.paused, false);
  g.stop();
});

test('the launcher refuses automatic launches while paused, and marks them so they are not counted as failures', async () => {
  const s = store();
  const g = new CaptchaGuard({ settings: settingsWith(), file: tmpFile() });
  g.trip(acc, 'x');
  const l = new Launcher({ helper: {}, settings: { get: () => 'replace', on() {} }, accounts: s, guard: g });
  l.persist = () => {};
  await assert.rejects(l._launch('a1', { type: 'game', placeId: 1 }, 'keep-alive'), (e) => e.guardPaused === true);
  await assert.rejects(l._launch('a1', { type: 'game', placeId: 1 }, 'api'), (e) => e.guardPaused === true);
  g.stop();
});

test('settings clamp the captcha guard values and keep the switches as booleans', () => {
  const st = new Settings();
  const d = st.update({ captchaGuard: { enabled: 1, pauseAll: '', autoResumeMin: 99999 } });
  assert.equal(d.captchaGuard.enabled, true);
  assert.equal(d.captchaGuard.pauseAll, false);
  assert.equal(d.captchaGuard.autoResumeMin, 1440);
  const w = st.update({ watchdog: { breakerDisconnects: 500, breakerWindowMin: 1 } });
  assert.equal(w.watchdog.breakerDisconnects, 50);
  assert.equal(w.watchdog.breakerWindowMin, 5);
});
