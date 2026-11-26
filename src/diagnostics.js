'use strict';

/**
 * A plain-text report a person can attach to a bug report: versions, health findings, fleet and run
 * summaries, settings and the latest activity. Secrets never go in: keys that look like credentials are
 * hidden, and every string is scrubbed for webhooks, Roblox cookies and the Windows user name.
 * Pure: takes the already-built UI state, so it can be tested without a running manager.
 */
const HIDE_KEY = /webhook|password|secret|token|cookie|auth|api[-_]?key|private/i;
const WEBHOOK_RE = /https?:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api\/webhooks\/\S+/gi;
const COOKIE_RE = /_\|WARNING:[^|]*\|_[A-Za-z0-9+/=_\-.]+/g;
const USER_PATH_RE = /([A-Za-z]:\\Users\\)[^\\/\s"']+/gi;

function scrubText(s) {
  return String(s).replace(WEBHOOK_RE, '[WEBHOOK]').replace(COOKIE_RE, '[COOKIE]').replace(USER_PATH_RE, '$1<user>');
}

function sanitize(v, depth = 0) {
  if (depth > 6) return '[nested too deep]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitize(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (HIDE_KEY.test(k) && typeof val !== 'boolean') out[k] = val ? '[hidden]' : val;
      else out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return typeof v === 'string' ? scrubText(v) : v;
}

const num = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : 'n/a');

function buildReport({ state = {}, logs = [], now = Date.now(), versions = {} } = {}) {
  const L = [];
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  const fleet = (state.launcher && state.launcher.fleet) || {};
  const instances = (state.launcher && state.launcher.instances) || [];
  const runs = state.runs || null;

  L.push("# 10k's Account Manager diagnostics", '');
  L.push(`Generated: ${new Date(now).toISOString()}`);
  L.push(`App ${versions.app || 'unknown'}, Node ${versions.node || 'unknown'}, ${versions.os || 'unknown OS'}`, '');

  L.push('## Roblox');
  const rb = state.roblox;
  L.push(rb ? `Found: ${scrubText(rb.path || 'yes')}${rb.version ? `, version ${rb.version}` : ''}` : 'Not found');
  if (runs && runs.build) L.push(`Build seen in logs: ${runs.build.current || 'unknown'}${runs.build.changed ? ` (changed from ${runs.build.previous})` : ''}`);
  L.push('');

  L.push('## Findings');
  const pf = Array.isArray(state.preflight) ? state.preflight : [];
  if (!pf.length) L.push('None.');
  for (const p of pf) L.push(`- [${p.level}] ${scrubText(p.text)}`);
  L.push('');

  L.push('## Fleet right now');
  L.push(`Clients: ${instances.length}, queued: ${state.launcher && state.launcher.queued ? state.launcher.queued.length : 0}`);
  L.push(`Client memory: ${num(fleet.totalPrivGB, 2)} GB, free commit: ${num(fleet.freeGB)} GB of ${num(fleet.limitGB, 0)} GB, growth: ${num(fleet.meanMBPerMin, 0)} MB/min per client (${fleet.trend ? fleet.trend.label : 'n/a'}), level: ${fleet.level || 'n/a'}`);
  L.push('');

  L.push('## Last 24 hours');
  L.push(runs ? `Runs ended: ${runs.runs ?? runs.total ?? 'n/a'}, unplanned exits: ${runs.exits ?? 0}` : 'No run history yet.');
  L.push('');

  L.push('## Accounts');
  const by = {};
  for (const a of accounts) by[a.status || 'unknown'] = (by[a.status || 'unknown'] || 0) + 1;
  L.push(`Total ${accounts.length}${Object.keys(by).length ? ` (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}, keep-alive on: ${accounts.filter((a) => a.keepAlive && a.keepAlive.enabled).length}`);
  L.push('Account names, cookies and passwords are not included.', '');

  L.push('## Settings');
  L.push('```json', JSON.stringify(sanitize(state.settings || {}), null, 2), '```', '');

  L.push(`## Recent activity (last ${Math.min(logs.length, 150)} lines)`);
  for (const l of logs.slice(-150)) L.push(scrubText(`${new Date(l.t).toISOString()} [${l.level}] ${l.scope}: ${l.msg}`));
  let out = L.join('\n') + '\n';
  // Account names can show up inside findings or log lines; the report promises none, so mask every known name.
  const names = [...new Set(accounts.map((x) => x && x.username).filter((n) => typeof n === 'string' && n.length >= 3))];
  for (const n of names) out = out.replace(new RegExp('(?<![A-Za-z0-9_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'gi'), '[account]');
  return out;
}

module.exports = { buildReport, sanitize, scrubText };
