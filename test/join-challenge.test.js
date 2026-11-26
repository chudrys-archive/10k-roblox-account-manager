'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-challenge-'));
const { EventEmitter } = require('node:events');
const { LogWatcher, isJoinChallenge } = require('../src/logwatch');
const { DEFAULTS, Settings } = require('../src/settings');

const REAL_403 = "2026-11-26T01:39:30.754Z,0.754743,2efc,12 [DFLog::HttpTraceError] HttpResponse(#17 0x235b30c5bf8) time:116.6ms (net:116.6ms timeInRetryQueue:0.0ms)status:403  bodySize:82 url:{ \"https://gamejoin.roblox.com/v1/join-game\" } ip:128.116.48.3 external:0 numberOfTimesRetried:0 challengedByGcs";

test('a join-game 403 flagged challengedByGcs is a challenge', () => {
  assert.strictEqual(isJoinChallenge(REAL_403), true);
});

test('other join-game or http lines are not', () => {
  assert.strictEqual(isJoinChallenge(REAL_403.replace('challengedByGcs', '')), false, '403 without the challenge flag');
  assert.strictEqual(isJoinChallenge(REAL_403.replace('status:403', 'status:200')), false);
  assert.strictEqual(isJoinChallenge(REAL_403.replace('v1/join-game', 'v1/other')), false);
  assert.strictEqual(isJoinChallenge('[FLog::Network] Connection lost'), false);
  assert.strictEqual(isJoinChallenge(undefined), false);
});

test('sign-in gap defaults to 2 minutes and is kept in range', () => {
  assert.strictEqual(DEFAULTS.signInGapSec, 120);
  const st = new Settings();
  const n = (v) => { st.update({ signInGapSec: v }); return st.get('signInGapSec'); };
  assert.strictEqual(n(10), 30);
  assert.strictEqual(n(5000), 600);
  assert.strictEqual(n(180), 180);
  assert.strictEqual(n('abc'), 120);
});
test('a join challenge is only reported: no verification event, so the client and the account are left alone', () => {
  const lw = new LogWatcher({ launcher: new EventEmitter(), dir: os.tmpdir() });
  const seen = [];
  lw.on('verification', () => seen.push('verification'));
  lw.on('joinchallenge', () => seen.push('joinchallenge'));
  const inst = { accountId: 'a1' };
  lw.parse(inst, REAL_403);
  lw.parse(inst, REAL_403);
  assert.deepStrictEqual(seen, ['joinchallenge'], 'reported once, never as a verification');
});

test('the challenge steps the client prints while it shows the page are not a verification either', () => {
  const lw = new LogWatcher({ launcher: new EventEmitter(), dir: os.tmpdir() });
  let verification = false;
  lw.on('verification', () => { verification = true; });
  const inst = { accountId: 'a2' };
  lw.parse(inst, '[FLog::NewWebView2Browser] Webview handles hybrid javascript event {"params":{"feature":"challengeDisplayed","data":{"displayed":true}}}');
  lw.parse(inst, '[FLog::NewWebView2Browser] Webview handles hybrid javascript event {"params":{"feature":"challengeCompleted","data":{"challengeType":"captchav2"}}}');
  assert.strictEqual(verification, false);
});
test('the client UI getting "Challenge required" from account-unlock-api is still a verification signal', () => {
  const lw = new LogWatcher({ launcher: new EventEmitter(), dir: os.tmpdir() });
  const seen = [];
  lw.on('verification', () => seen.push('verification'));
  const inst = { accountId: 'a3' };
  lw.parse(inst, '2026-11-26T02:11:10.579Z,327.579010,4a90,6,Warning [FLog::CreatorWarning] Warning: [Roblox][CorePackages.LuauForgeChunks.bundled] HTTP error body:`{"errors":[{"code":0,"message":"Challenge required to authorize request"}]}');
  lw.parse(inst, '[FLog::VerifyPatch] human verification patch loaded');
  assert.deepStrictEqual(seen, ['verification'], 'the unlock error counts once; the VerifyPatch feature name never does');
});
test('a real "challenge required" line outside those sources still counts as a verification', () => {
  const lw = new LogWatcher({ launcher: new EventEmitter(), dir: os.tmpdir() });
  let verification = 0;
  lw.on('verification', () => { verification++; });
  const inst = { accountId: 'a4' };
  lw.parse(inst, '[FLog::Network] Challenge required: human verification needed to continue');
  lw.parse(inst, '[FLog::Network] Challenge required: human verification needed to continue');
  assert.strictEqual(verification, 1);
});