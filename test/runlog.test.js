'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RunLog, buildRecord, exitKind, summarize, MAX_RECORDS } = require('../src/runlog');

const MIN = 60e3;

test('exitKind: deliberate close, disconnect, unexplained exit', () => {
  assert.equal(exitKind({ killReason: 'user' }).kind, 'closed');
  assert.deepEqual(exitKind({ log: { disconnectedAt: 5, reason: 'kicked' } }), { kind: 'disconnected', reason: 'kicked' });
  assert.equal(exitKind({}).kind, 'exited');
});

test('buildRecord computes uptime and flags short unrequested exits', () => {
  const now = 10 * 60 * MIN;
  const r = buildRecord({ accountId: 'a', startedAt: now - 5 * MIN, peakPrivMB: 2900.4, privMB: 2800.6 }, 'u1', now);
  assert.equal(r.uptimeMs, 5 * MIN);
  assert.equal(r.peakPrivMB, 2900);
  assert.equal(r.lastPrivMB, 2801);
  assert.equal(r.short, true);
  const ok = buildRecord({ accountId: 'a', startedAt: now - 5 * MIN, killReason: 'close all' }, 'u1', now);
  assert.equal(ok.short, false);
  const long = buildRecord({ accountId: 'a', startedAt: now - 90 * MIN }, 'u1', now);
  assert.equal(long.short, false);
});

test('summarize rolls runs up per account', () => {
  const recs = [
    { accountId: 'a', username: 'A', uptimeMs: 10 * MIN, peakPrivMB: 100, kind: 'exited', short: true },
    { accountId: 'a', username: 'A', uptimeMs: 50 * MIN, peakPrivMB: 300, kind: 'closed', short: false },
    { accountId: 'b', username: 'B', uptimeMs: 5 * MIN, peakPrivMB: 50, kind: 'disconnected', short: true },
  ];
  const s = Object.fromEntries(summarize(recs).map((x) => [x.accountId, x]));
  assert.equal(s.a.runs, 2); assert.equal(s.a.crashes, 1); assert.equal(s.a.shortRuns, 1);
  assert.equal(s.a.meanUptimeMs, 30 * MIN); assert.equal(s.a.longestMs, 50 * MIN); assert.equal(s.a.peakPrivMB, 300);
  assert.equal(s.b.crashes, 1);
});

test('RunLog persists, reloads, skips torn lines and filters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runlog-'));
  const file = path.join(dir, 'runs.jsonl');
  const log = new RunLog({ file });
  log.add({ accountId: 'a', startedAt: 1, endedAt: 2, uptimeMs: 1, kind: 'closed' });
  log.add({ accountId: 'b', startedAt: 3, endedAt: 9, uptimeMs: 6, kind: 'exited' });
  fs.appendFileSync(file, '{"accountId":"c","startedAt":\n');
  const again = new RunLog({ file });
  assert.equal(again.records.length, 2);
  assert.equal(again.list()[0].accountId, 'b');
  assert.equal(again.list({ accountId: 'a' }).length, 1);
  assert.equal(again.list({ sinceMs: 5 }).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('RunLog caps the record count', () => {
  const log = new RunLog({});
  for (let i = 0; i < MAX_RECORDS + 5; i++) log.add({ accountId: 'a', startedAt: i, endedAt: i + 1, uptimeMs: 1, kind: 'closed' });
  assert.equal(log.records.length, MAX_RECORDS);
});

test('parseLogVersion reads the Roblox version from a client log name', () => {
  const { parseLogVersion } = require('../src/runlog');
  assert.equal(parseLogVersion('0.748.0.7481526_20261125T030640Z_Player_FF169_last.log'), '0.748.0.7481526');
  assert.equal(parseLogVersion('something_else.log'), '');
  assert.equal(parseLogVersion(undefined), '');
});

test('stats24h counts only the last day, buildInfo flags a version change', () => {
  const now = Date.now();
  const log = new RunLog({});
  log.add({ accountId: 'a', startedAt: now - 50 * 3600e3, endedAt: now - 49 * 3600e3, uptimeMs: 1, kind: 'exited', short: true, robloxVersion: '0.747.0.1' });
  log.add({ accountId: 'a', startedAt: now - 3 * 3600e3, endedAt: now - 2 * 3600e3, uptimeMs: 1, kind: 'exited', short: true, robloxVersion: '0.748.0.2' });
  log.add({ accountId: 'b', startedAt: now - 3 * 3600e3, endedAt: now - 1 * 3600e3, uptimeMs: 1, kind: 'closed', short: false, robloxVersion: '0.748.0.2' });
  assert.deepEqual(log.stats24h(now), { runs: 2, exits: 1, short: 1, last: { at: now - 2 * 3600e3, accountId: 'a', username: undefined, kind: 'exited', reason: undefined } });
  assert.deepEqual(log.buildInfo(['0.748.0.2']), { current: '0.748.0.2', previous: '0.747.0.1', changed: true });
  assert.deepEqual(log.buildInfo([]), { current: '0.748.0.2', previous: '0.747.0.1', changed: true });
  assert.equal(new RunLog({}).buildInfo([]).changed, false);
});
