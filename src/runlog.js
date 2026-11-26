'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('./util');

const MAX_RECORDS = 2000;
const CRASH_UPTIME_MS = 30 * 60e3; // an unrequested exit sooner than this counts as a short run

/**
 * Classify why a client run ended. `inst.killReason` is set when the manager closed it on purpose;
 * a disconnect code from the client log means Roblox ended the session; exit code 0 with nothing else
 * means the window was closed by hand; any other code, or none readable, is counted as unplanned.
 */
function exitKind(inst) {
  if (inst && inst.killReason) return { kind: 'closed', reason: String(inst.killReason) };
  const log = inst && inst.log;
  if (log && log.disconnectedAt) return { kind: 'disconnected', reason: String(log.reason || 'disconnected') };
  if (inst && inst.exitCode === 0) return { kind: 'closed', reason: 'closed by hand' };
  const code = inst && inst.exitCode;
  return { kind: 'exited', reason: code != null ? `client exited with code ${code} (0x${(code >>> 0).toString(16).toUpperCase()})` : 'client exited without being asked to' };
}

/** Pure: the Roblox version in a client log file name ("0.748.0.7481526_2026...Player_XXXX_last.log"), or ''. */
function parseLogVersion(name) {
  const m = /^(\d+\.\d+\.\d+\.\d+)_/.exec(String(name || ''));
  return m ? m[1] : '';
}

/** One finished run, as stored. All numbers are plain, nothing here depends on the game build. */
function buildRecord(inst, username, now = Date.now()) {
  const started = Number(inst.startedAt) || now;
  const { kind, reason } = exitKind(inst);
  const log = inst.log;
  return {
    accountId: inst.accountId,
    username: username || '',
    startedAt: started,
    endedAt: now,
    uptimeMs: Math.max(0, now - started),
    peakPrivMB: Math.round(Number(inst.peakPrivMB) || 0),
    lastPrivMB: Math.round(Number(inst.privMB) || 0),
    kind,
    reason,
    launchReason: inst.reason || '',
    robloxVersion: (log && log.robloxVersion) || '',
    short: kind !== 'closed' && now - started < CRASH_UPTIME_MS,
  };
}

/** Per-account roll-up used by the health view and run reports. */
function summarize(records) {
  const by = new Map();
  for (const r of records) {
    let s = by.get(r.accountId);
    if (!s) { s = { accountId: r.accountId, username: r.username, runs: 0, crashes: 0, shortRuns: 0, totalUptimeMs: 0, longestMs: 0, peakPrivMB: 0 }; by.set(r.accountId, s); }
    s.runs++;
    if (r.kind !== 'closed') s.crashes++;
    if (r.short) s.shortRuns++;
    s.totalUptimeMs += r.uptimeMs;
    s.longestMs = Math.max(s.longestMs, r.uptimeMs);
    s.peakPrivMB = Math.max(s.peakPrivMB, r.peakPrivMB);
    if (r.username) s.username = r.username;
  }
  return [...by.values()].map((s) => ({ ...s, meanUptimeMs: s.runs ? Math.round(s.totalUptimeMs / s.runs) : 0 }));
}

/** Append-only run history on disk (one JSON object per line). Corrupt lines are skipped. */
class RunLog {
  constructor({ file } = {}) {
    this.file = file || null;
    this.records = [];
    this.load();
  }

  load() {
    if (!this.file) return;
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return; }
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r && typeof r.accountId === 'string' && Number.isFinite(r.startedAt) && Number.isFinite(r.endedAt)) out.push(r);
      } catch { /* skip a torn line */ }
    }
    this.records = out.slice(-MAX_RECORDS);
    if (out.length > MAX_RECORDS) this.rewrite();
  }

  rewrite() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      atomicWrite(this.file, this.records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch { /* disk problems must not stop the manager */ }
  }

  add(record) {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) { this.records.splice(0, this.records.length - MAX_RECORDS); this.rewrite(); return record; }
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.appendFileSync(this.file, JSON.stringify(record) + '\n');
      } catch { /* ignore */ }
    }
    return record;
  }

  /** Newest first. */
  list({ accountId, limit = 100, sinceMs = 0 } = {}) {
    const out = [];
    for (let i = this.records.length - 1; i >= 0 && out.length < limit; i--) {
      const r = this.records[i];
      if (accountId && r.accountId !== accountId) continue;
      if (sinceMs && r.endedAt < sinceMs) continue;
      out.push(r);
    }
    return out;
  }

  /** Runs, unrequested exits and short runs in the last 24 hours. */
  stats24h(now = Date.now()) {
    const since = now - 24 * 3600e3;
    let runs = 0; let exits = 0; let short = 0; let last = null;
    for (const r of this.records) {
      if (r.endedAt < since) continue;
      runs++;
      if (r.kind !== 'closed') {
        exits++;
        if (!last || r.endedAt > last.at) last = { at: r.endedAt, accountId: r.accountId, username: r.username, kind: r.kind, reason: r.reason };
      }
      if (r.short) short++;
    }
    return { runs, exits, short, last };
  }

  /**
   * Roblox build tracking. current = the version live clients report (newest by sort order if they differ),
   * else the newest recorded run's; previous = the newest recorded version that differs from it.
   * changed = a recorded run used a different version than the one in use now.
   */
  buildInfo(liveVersions = []) {
    const live = liveVersions.filter(Boolean);
    const recorded = this.records.map((r) => r.robloxVersion).filter(Boolean);
    const current = live.length ? live.slice().sort().pop() : (recorded[recorded.length - 1] || '');
    let previous = '';
    for (let i = recorded.length - 1; i >= 0; i--) if (recorded[i] !== current) { previous = recorded[i]; break; }
    return { current, previous, changed: !!(current && previous) };
  }

  summary({ sinceMs = 0 } = {}) { return summarize(this.records.filter((r) => r.endedAt >= sinceMs)); }
}

module.exports = { parseLogVersion, RunLog, buildRecord, exitKind, summarize, MAX_RECORDS, CRASH_UPTIME_MS };
