'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-lw-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { LogWatcher } = require('../src/logwatch');

const ts = () => new Date().toISOString();
const L = {
  head: (btid) => `${ts()},0.2,5d0c,6,Warning [FLog::Warning] Set-Cookie RBXEventTrackerV2 detected from https://apis.roblox.com/browser-tracker-api/device/initialize?suggestedBrowserTrackerId=${btid}\n`,
  inherited: (btid) => `${ts()},0.1,653c,6 [FLog::LogWin32BTId] LogWin32BTId, App, cookie Native => Engine set RBXEventTrackerV2 as CreateDate=x&rbxuid=1&browserid=${btid}\n`,
  join: (job, place) => `${ts()},0.8,21f4,6 [FLog::Output] ! Joining game '${job}' place ${place} at 10.0.0.1\n`,
  disc: (code) => `${ts()},9.1,4218,7 [FLog::Network] Disconnection Notification. Reason: ${code}\n`,
};
const JOB1 = '11111111-2222-3333-4444-555555555555';
const JOB2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('matches logs by launch tag only, and tracks join / disconnect / teleport', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxlogs-'));
  const launcher = new EventEmitter();
  const a = { pid: 1, btid: '1000000000000111', startedAt: Date.now() };
  const b = { pid: 2, btid: '1000000000000222', startedAt: Date.now() };
  launcher.instances = new Map([[1, a], [2, b]]);

  // b's log *inherits* a's btid in a browserid= line - must not be mistaken for a's log
  const fa = path.join(dir, '0.748_20261118T020000Z_Player_AAAAA_last.log');
  const fb = path.join(dir, '0.748_20261118T020001Z_Player_BBBBB_last.log');
  fs.writeFileSync(fb, L.inherited(a.btid) + L.head(b.btid) + L.join(JOB1, 189707));
  fs.writeFileSync(fa, L.head(a.btid) + L.join(JOB1, 189707));
  fs.writeFileSync(path.join(dir, 'x_Player_CCCCC_CrashHandler_last.log'), L.head(a.btid)); // ignored

  const lw = new LogWatcher({ launcher, dir });
  const events = [];
  lw.on('join', (i, s) => events.push(['join', i.pid, s.jobId]));
  lw.on('disconnect', (i, s) => events.push(['disc', i.pid, s.code]));
  lw.tick();
  assert.equal(lw.files.get(1).file, fa);
  assert.equal(lw.files.get(2).file, fb);
  assert.equal(a.logState.inGame, true);
  assert.equal(a.logState.jobId, JOB1);

  // kicked: disconnect with no rejoin
  fs.appendFileSync(fa, L.disc(267));
  lw.tick();
  assert.equal(a.logState.inGame, false);
  assert.equal(a.logState.code, 267);
  assert.match(a.logState.reason, /kicked/);
  assert.ok(a.logState.disconnectedAt > 0);

  // teleport on b: disconnect then immediate join -> back in game, disconnect cleared
  fs.appendFileSync(fb, L.disc(285) + L.join(JOB2, 189707));
  lw.tick();
  assert.equal(b.logState.inGame, true);
  assert.equal(b.logState.jobId, JOB2);
  assert.equal(b.logState.disconnectedAt, 0);

  // partial line written in two chunks is handled
  fs.appendFileSync(fa, `${ts()},1,1,6 [FLog::Output] ! Joining ga`);
  lw.tick();
  assert.equal(a.logState.inGame, false);
  fs.appendFileSync(fa, `me '${JOB2}' place 1\n`);
  lw.tick();
  assert.equal(a.logState.inGame, true);
  assert.deepEqual(events.map((e) => e[0]), ['join', 'join', 'disc', 'disc', 'join', 'join']);
});
