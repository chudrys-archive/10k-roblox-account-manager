'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-verify-'));

const test = require('node:test');
const assert = require('node:assert');
const { AccountStore } = require('../src/accounts');
const { Launcher } = require('../src/launcher');
const { VERIFY_RE } = require('../src/logwatch');
const { api } = require('../src/roblox');

function store() {
  const s = new AccountStore({ data: { accounts: [{ id: 'a1', userId: 7, username: 'alt', cookie: 'x'.repeat(120), status: 'valid', keepAlive: { enabled: true } }] }, save() {}, locked: false });
  s.load();
  return s;
}

test('a verification request locks the account, pauses keep-alive and tells listeners once', () => {
  const s = store();
  const acc = s.get('a1');
  const seen = [];
  s.on('verification', (a, where) => seen.push([a.id, where]));
  assert.equal(s.markVerification(acc, 'sign-in ticket'), true);
  assert.equal(acc.status, 'verify');
  assert.equal(acc.keepAlive.enabled, false);
  assert.equal(acc.keepAlive.pausedForVerify, true);
  assert.equal(s.markVerification(acc, 'again'), false, 'flagged only once');
  assert.deepEqual(seen, [['a1', 'sign-in ticket']]);
  assert.equal(s.publicView(acc).status, 'verify');
});

test('Validate clears the label only when Roblox gives a sign-in ticket again', async (t) => {
  const s = store();
  const acc = s.get('a1');
  s.markVerification(acc, 'client');
  t.mock.method(api, 'getAuthenticated', async () => ({ id: 7, name: 'alt', displayName: 'alt' }));
  t.mock.method(api, 'getModeration', async () => null);
  t.mock.method(api, 'getRobux', async () => 5);
  const ticket = t.mock.method(api, 'getAuthTicket', async () => { throw Object.assign(new Error('challenge'), { verification: true }); });
  await s.validate(acc);
  assert.equal(acc.status, 'verify', 'still challenged -> label stays');
  ticket.mock.mockImplementation(async () => 'ticket');
  await s.validate(acc);
  assert.equal(acc.status, 'valid');
  assert.equal(acc.keepAlive.enabled, true, 'keep-alive resumes');
  assert.equal(acc.keepAlive.pausedForVerify, undefined);
});

test('an account that needs verification is never launched', async () => {
  const s = store();
  s.markVerification(s.get('a1'), 'client');
  const l = new Launcher({ helper: {}, settings: { get: () => 'replace', on() {} }, accounts: s });
  l.persist = () => {};
  await assert.rejects(l._launch('a1', { type: 'game', placeId: 1 }, 'manual'), /needs verification/);
});

test('client log lines that mean a captcha / security check are recognised', () => {
  assert.ok(VERIFY_RE.test('[FLog::Output] Captcha shown to user'));
  assert.ok(VERIFY_RE.test('Error: Challenge is required to authorize the request'));
  assert.ok(VERIFY_RE.test('rblx-challenge-id: abc'));
  assert.ok(!VERIFY_RE.test('[FLog::DataModelPatchConfigurer] deserializeAndVerifyPatch with blake3'));
  assert.ok(!VERIFY_RE.test('! Joining game'));
});
