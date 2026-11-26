'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Full backups of the manager's own data: the encrypted accounts vault, settings and run history.
 * A backup is a folder under <data>/backups with a manifest.json written last, so a half-written
 * backup (no manifest) is never listed or restored. Restores are staged and applied at the next
 * start, before anything has the files open, and the current data is backed up first.
 * Every function takes the data directory so it can be tested against a temp folder.
 */
const FILES = ['accounts.vault', 'settings.json', 'runs.jsonl'];
const REQUIRED = ['accounts.vault', 'settings.json'];
const KEEP = 10;
const NAME_RE = /^full-\d{8}T\d{6}Z(?:-\d+)?$/;
const PENDING = 'restore-pending.json';

const dirOf = (dataDir) => path.join(dataDir, 'backups');
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('invalid backup name');
  return name;
}

function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (m && m.v === 1 && Array.isArray(m.files)) return m;
  } catch {}
  return null;
}

function listBackups(dataDir) {
  const root = dirOf(dataDir);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    const m = readManifest(path.join(root, name));
    if (!m) continue;
    out.push({ name, createdAt: m.createdAt, reason: m.reason, appVersion: m.appVersion || null, bytes: m.files.reduce((n, f) => n + f.bytes, 0), files: m.files.map((f) => f.name) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
}

function createBackup(dataDir, { reason = 'manual', now = Date.now(), appVersion = null } = {}) {
  for (const f of REQUIRED) if (!fs.existsSync(path.join(dataDir, f))) throw new Error(`nothing to back up: ${f} is missing`);
  const root = dirOf(dataDir);
  fs.mkdirSync(root, { recursive: true });
  let name = `full-${stamp(now)}`;
  for (let n = 2; fs.existsSync(path.join(root, name)); n++) name = `full-${stamp(now)}-${n}`;
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  try {
    const files = [];
    for (const f of FILES) {
      const src = path.join(dataDir, f);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(dir, f));
      files.push({ name: f, bytes: fs.statSync(path.join(dir, f)).size, sha256: sha256File(path.join(dir, f)) });
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ v: 1, createdAt: now, reason, appVersion, files }, null, 2));
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  prune(dataDir);
  return listBackups(dataDir).find((b) => b.name === name);
}

function prune(dataDir, keep = KEEP) {
  const all = listBackups(dataDir);
  for (const b of all.slice(keep)) fs.rmSync(path.join(dirOf(dataDir), b.name), { recursive: true, force: true });
  // sweep folders that never got a manifest (interrupted backups)
  try {
    for (const name of fs.readdirSync(dirOf(dataDir))) {
      if (NAME_RE.test(name) && !readManifest(path.join(dirOf(dataDir), name))) fs.rmSync(path.join(dirOf(dataDir), name), { recursive: true, force: true });
    }
  } catch {}
}

function verifyBackup(dataDir, name) {
  const problems = [];
  const dir = path.join(dirOf(dataDir), assertName(name));
  const m = readManifest(dir);
  if (!m) return { ok: false, problems: ['manifest missing or unreadable'] };
  for (const f of REQUIRED) if (!m.files.some((x) => x.name === f)) problems.push(`${f} is not part of this backup`);
  for (const f of m.files) {
    if (!FILES.includes(f.name)) { problems.push(`unexpected file ${f.name}`); continue; }
    const p = path.join(dir, f.name);
    if (!fs.existsSync(p)) { problems.push(`${f.name} is missing`); continue; }
    if (fs.statSync(p).size !== f.bytes || sha256File(p) !== f.sha256) problems.push(`${f.name} does not match its checksum`);
  }
  if (!problems.length) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      if (!s || typeof s !== 'object' || Array.isArray(s)) problems.push('settings.json is not an object');
    } catch { problems.push('settings.json is not valid JSON'); }
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.vault'), 'utf8'));
      if (v.v !== 1 || !['dpapi', 'scrypt'].includes(v.kdf) || !v.iv || !v.tag || !v.data) problems.push('accounts.vault is not a vault file');
    } catch { problems.push('accounts.vault is not a vault file'); }
  }
  return { ok: problems.length === 0, problems };
}

function pendingRestore(dataDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dataDir, PENDING), 'utf8'));
    return p && NAME_RE.test(p.name) ? p : null;
  } catch { return null; }
}

/** Mark a backup to be restored at the next start. Nothing is overwritten now. */
function stageRestore(dataDir, name, now = Date.now()) {
  const v = verifyBackup(dataDir, name);
  if (!v.ok) throw new Error('backup failed verification: ' + v.problems.join('; '));
  fs.writeFileSync(path.join(dataDir, PENDING), JSON.stringify({ name, stagedAt: now }));
  return pendingRestore(dataDir);
}

function cancelRestore(dataDir) { fs.rmSync(path.join(dataDir, PENDING), { force: true }); }

function deleteBackup(dataDir, name) {
  const dir = path.join(dirOf(dataDir), assertName(name));
  if (!fs.existsSync(dir)) throw new Error('backup not found');
  const p = pendingRestore(dataDir);
  if (p && p.name === name) throw new Error('this backup is staged for restore; cancel the restore first');
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Call once at start, before the settings or the vault are opened. */
function applyPendingRestore(dataDir, { now = Date.now(), appVersion = null, log = () => {} } = {}) {
  const p = pendingRestore(dataDir);
  if (!p) return { applied: false };
  cancelRestore(dataDir); // never loop on a bad restore
  const v = verifyBackup(dataDir, p.name);
  if (!v.ok) { log(`restore of ${p.name} skipped: ${v.problems.join('; ')}`); return { applied: false, name: p.name, problems: v.problems }; }
  let pre = null;
  try { pre = createBackup(dataDir, { reason: 'before restore', now, appVersion }); } catch (e) { log(`could not back up current data before restore: ${e.message}`); }
  const dir = path.join(dirOf(dataDir), p.name);
  const m = readManifest(dir);
  for (const f of m.files) {
    const dest = path.join(dataDir, f.name);
    const tmp = `${dest}.restore.tmp`;
    fs.copyFileSync(path.join(dir, f.name), tmp);
    fs.renameSync(tmp, dest);
  }
  log(`restored ${p.name} (${m.files.map((f) => f.name).join(', ')})`);
  return { applied: true, name: p.name, before: pre && pre.name };
}

/** True when the newest backup is older than maxAgeMs (or there is none). */
function needsAutoBackup(dataDir, { now = Date.now(), maxAgeMs = 24 * 3600 * 1000 } = {}) {
  const [latest] = listBackups(dataDir);
  return !latest || now - latest.createdAt >= maxAgeMs;
}

module.exports = { FILES, KEEP, createBackup, listBackups, verifyBackup, stageRestore, cancelRestore, pendingRestore, deleteBackup, applyPendingRestore, needsAutoBackup };
