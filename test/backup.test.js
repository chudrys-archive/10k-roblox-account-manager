'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../src/backup');

const VAULT = JSON.stringify({ v: 1, kdf: 'dpapi', iv: 'aa', tag: 'bb', data: 'cc' });
function tmpData(files = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  fs.writeFileSync(path.join(d, 'accounts.vault'), files.vault ?? VAULT);
  fs.writeFileSync(path.join(d, 'settings.json'), files.settings ?? '{"a":1}');
  if (files.runs) fs.writeFileSync(path.join(d, 'runs.jsonl'), files.runs);
  return d;
}

test('creates a backup with a manifest and lists it', () => {
  const d = tmpData({ runs: '{}\n' });
  const made = b.createBackup(d, { reason: 'manual', now: Date.UTC(2026, 10, 25, 1, 2, 3), appVersion: '7.1.4' });
  assert.equal(made.name, 'full-20261125T010203Z');
  assert.deepEqual(made.files.sort(), ['accounts.vault', 'runs.jsonl', 'settings.json']);
  assert.equal(b.listBackups(d).length, 1);
  assert.equal(b.verifyBackup(d, made.name).ok, true);
});

test('same-second backups get distinct names', () => {
  const d = tmpData();
  const now = Date.UTC(2026, 0, 1);
  const a = b.createBackup(d, { now });
  const c = b.createBackup(d, { now });
  assert.notEqual(a.name, c.name);
});

test('refuses to back up when the vault is missing', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  fs.writeFileSync(path.join(d, 'settings.json'), '{}');
  assert.throws(() => b.createBackup(d), /accounts\.vault is missing/);
});

test('keeps only the newest backups', () => {
  const d = tmpData();
  for (let i = 0; i < b.KEEP + 3; i++) b.createBackup(d, { now: Date.UTC(2026, 0, 1, 0, 0, i) });
  const all = b.listBackups(d);
  assert.equal(all.length, b.KEEP);
  assert.equal(all[0].createdAt, Date.UTC(2026, 0, 1, 0, 0, b.KEEP + 2));
});

test('verification catches a changed file and a bad name', () => {
  const d = tmpData();
  const m = b.createBackup(d);
  fs.appendFileSync(path.join(d, 'backups', m.name, 'settings.json'), ' ');
  const v = b.verifyBackup(d, m.name);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(), /checksum/);
  assert.throws(() => b.verifyBackup(d, '../etc'), /invalid backup name/);
  assert.throws(() => b.deleteBackup(d, 'full-1/../..'), /invalid backup name/);
});

test('restore is staged, then applied once at start with a safety backup', () => {
  const d = tmpData({ settings: '{"v":"old"}' });
  const m = b.createBackup(d, { now: Date.UTC(2026, 0, 1) });
  fs.writeFileSync(path.join(d, 'settings.json'), '{"v":"new"}');
  b.stageRestore(d, m.name);
  assert.equal(fs.readFileSync(path.join(d, 'settings.json'), 'utf8'), '{"v":"new"}', 'staging must not touch live files');
  const r = b.applyPendingRestore(d, { now: Date.UTC(2026, 0, 2) });
  assert.equal(r.applied, true);
  assert.equal(fs.readFileSync(path.join(d, 'settings.json'), 'utf8'), '{"v":"old"}');
  const before = b.listBackups(d).find((x) => x.name === r.before);
  assert.equal(before.reason, 'before restore');
  assert.equal(b.pendingRestore(d), null);
  assert.equal(b.applyPendingRestore(d).applied, false);
});

test('a corrupt staged backup is skipped and does not loop', () => {
  const d = tmpData();
  const m = b.createBackup(d);
  b.stageRestore(d, m.name);
  fs.appendFileSync(path.join(d, 'backups', m.name, 'accounts.vault'), 'x');
  const logs = [];
  const r = b.applyPendingRestore(d, { log: (s) => logs.push(s) });
  assert.equal(r.applied, false);
  assert.equal(b.pendingRestore(d), null);
  assert.match(logs.join(), /skipped/);
});

test('cannot delete a backup that is staged for restore', () => {
  const d = tmpData();
  const m = b.createBackup(d);
  b.stageRestore(d, m.name);
  assert.throws(() => b.deleteBackup(d, m.name), /staged/);
  b.cancelRestore(d);
  b.deleteBackup(d, m.name);
  assert.equal(b.listBackups(d).length, 0);
});

test('auto backup is due when none exists or the newest is old', () => {
  const d = tmpData();
  assert.equal(b.needsAutoBackup(d), true);
  const now = Date.UTC(2026, 0, 1);
  b.createBackup(d, { now });
  assert.equal(b.needsAutoBackup(d, { now: now + 3600e3 }), false);
  assert.equal(b.needsAutoBackup(d, { now: now + 25 * 3600e3 }), true);
});
