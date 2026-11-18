'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.IRAM_DATA_DIR || path.join(ROOT, 'data');
for (const d of ['logs', 'backups', 'tmp']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

const bus = new EventEmitter();
bus.setMaxListeners(200);

// ---------- cookie helpers ----------
const COOKIE_RE = /_\|WARNING:[^|]*\|_[A-Za-z0-9+/=_\-.]+/;
const COOKIE_RE_G = /_\|WARNING:[^|]*\|_[A-Za-z0-9+/=_\-.]+/g;

/** Pull a .ROBLOSECURITY value out of arbitrary text (raw cookie, "name=value", JSON, user:pass:cookie...). */
function extractCookie(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(COOKIE_RE);
  if (m) return m[0];
  // cookie without the warning prefix (rare, but accept long opaque tokens)
  const raw = s.replace(/^\.ROBLOSECURITY=/i, '').replace(/^["']|["';]$/g, '').trim();
  if (/^[A-Za-z0-9+/=_\-.]{100,}$/.test(raw)) return raw;
  return null;
}

function redact(s) {
  return String(s)
    .replace(COOKIE_RE_G, '[COOKIE]')
    .replace(/(gameinfo:)[^+\s]+/gi, '$1[TICKET]')
    .replace(/("?authenticationTicket"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1[TICKET]');
}

// ---------- logging ----------
const ring = [];
const LOG_FILE = path.join(DATA, 'logs', 'manager.log');
function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      try { fs.rmSync(LOG_FILE + '.1', { force: true }); } catch {}
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch {}
}
let logCount = 0;
function log(level, scope, msg) {
  const entry = { t: new Date().toISOString(), level, scope, msg: redact(msg instanceof Error ? msg.message : msg) };
  ring.push(entry);
  if (ring.length > 1500) ring.shift();
  bus.emit('log', entry);
  if (++logCount % 200 === 0) rotateIfNeeded();
  try { fs.appendFileSync(LOG_FILE, `${entry.t} [${level.toUpperCase()}] ${scope}: ${entry.msg}\n`); } catch {}
  if (process.env.IRAM_DEBUG || level === 'error') console.log(`[${level}] ${scope}: ${entry.msg}`);
}
const logger = (scope) => ({
  info: (m) => log('info', scope, m),
  warn: (m) => log('warn', scope, m),
  error: (m) => log('error', scope, m),
  debug: (m) => { if (process.env.IRAM_DEBUG) log('debug', scope, m); },
});

// ---------- fs helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Write atomically: tmp file + fsync + rename, retrying around AV/indexer locks. */
function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  let lastErr;
  for (let i = 0; i < 10; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      lastErr = e;
      const until = Date.now() + 50 * (i + 1);
      while (Date.now() < until) { /* short sync spin: callers expect sync semantics */ }
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch {}
  throw lastErr;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

async function rmrf(dir, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { await sleep(500); }
  }
  return false;
}

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  if (over && typeof over === 'object') {
    for (const k of Object.keys(over)) {
      out[k] = (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? deepMerge(base[k], over[k]) : over[k];
    }
  }
  return out;
}

/** Run async fn over items with a concurrency limit. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await fn(items[idx], idx) }; } catch (e) { results[idx] = { ok: false, error: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  ROOT, DATA, bus, log, logger, ring, sleep, atomicWrite, readJson, rmrf, deepMerge, pool,
  extractCookie, redact, uuid: () => crypto.randomUUID(),
};
