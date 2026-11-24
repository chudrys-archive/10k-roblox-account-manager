'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-idle-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { LogWatcher } = require('../src/logwatch');

test('idle kick (278) is read from the replicator line, which is the only place it appears', () => {
  const lw = new LogWatcher({ launcher: new EventEmitter(), dir: os.tmpdir() });
  const inst = { pid: 1, btid: 'x', startedAt: Date.now() };
  lw.parse(inst, '2026-11-24T01:05:10.470Z,1.0,1,6 [FLog::Network] Client:Disconnect setting replicator disconnect reason to 278');
  assert.equal(inst.logState.code, 278);
  assert.equal(inst.logState.inGame, false);
  assert.equal(inst.logState.reason, 'disconnected for being idle');
});
