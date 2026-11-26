'use strict';

// Per-client memory history and growth math. Pure data and arithmetic: no I/O, no timers, no
// Date.now() unless a caller leaves `now` out, so every function can be checked without Roblox.
//
// Units: memory in MB (what the helper reports as privMB, private commit), time in ms, slopes in MB/min.

const GB = 1024 ** 3;
const BASE_GAP_MS = 15000;      // one stored point per client at most every 15 s at first
const MAX_POINTS = 720;         // when full, every second point is dropped and the gap doubles (so 12 h+ still fits)
const MIN_SPAN_MS = 2 * 60e3;   // a slope needs points that span at least two minutes
const MIN_POINTS = 3;
const WARMUP_MS = 5 * 60e3;     // a client's first minutes are loading, not growth

// Trend labels and fleet levels are tuned on one test machine, not to anything universal:
// windows left open crept about 14 MB/min per client; minimized windows grew about 390 MB/min.
// They are defaults for the display, not limits the manager enforces.
const FLAT_BELOW_MB_MIN = 2;
const FAST_ABOVE_MB_MIN = 100;
const DEFAULT_KEEP_FREE_GB = 15;
const WATCH_FREE_GB = 40;
const DANGER_FREE_GB = 20;
const WATCH_HOURS = 6;
const DANGER_HOURS = 2;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Least-squares slope of value against time, in MB/min. null when there is too little to say. */
function linearSlope(points) {
  if (!Array.isArray(points) || points.length < MIN_POINTS) return null;
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0;
  if (!(span >= MIN_SPAN_MS)) return null;
  const n = points.length;
  let sx = 0; let sy = 0;
  for (const p of points) { sx += (p.t - t0) / 60e3; sy += p.v; }
  const mx = sx / n; const my = sy / n;
  let num = 0; let den = 0;
  for (const p of points) {
    const dx = (p.t - t0) / 60e3 - mx;
    num += dx * (p.v - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : null;
}

/** { id, label } for a slope in MB/min. */
function trendOf(slope) {
  if (!finite(slope)) return { id: 'unknown', label: 'measuring' };
  if (slope < FLAT_BELOW_MB_MIN) return { id: 'flat', label: 'flat' };
  if (slope < FAST_ABOVE_MB_MIN) return { id: 'creeping', label: 'creeping' };
  return { id: 'climbing', label: 'climbing fast' };
}

/** Hours until free commit would fall to `keepFreeGB` at `gbPerHour`. null when nothing is growing. */
function hoursToLimit({ freeGB, keepFreeGB = DEFAULT_KEEP_FREE_GB, gbPerHour }) {
  if (!finite(freeGB) || !finite(gbPerHour) || gbPerHour < 0.1) return null;
  const room = freeGB - keepFreeGB;
  return room <= 0 ? 0 : room / gbPerHour;
}

/** Keeps at most `n` values by averaging neighbours. Used for the sparkline. */
function downsample(values, n) {
  if (!Array.isArray(values) || n < 1) return [];
  if (values.length <= n) return values.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * values.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / n));
    let s = 0;
    for (let j = a; j < b; j++) s += values[j];
    out.push(s / (b - a));
  }
  return out;
}

class MetricsStore {
  constructor({ maxPoints = MAX_POINTS, baseGapMs = BASE_GAP_MS } = {}) {
    this.maxPoints = Math.max(8, maxPoints | 0);
    this.baseGapMs = baseGapMs;
    this.series = new Map(); // key -> { points: [{t, v}], gap, firstAt }
  }

  /** Stores one reading. Returns true when it was kept (too-frequent and invalid readings are dropped). */
  record(key, valueMB, now = Date.now()) {
    if (key == null || !finite(valueMB) || valueMB < 0 || !finite(now)) return false;
    let s = this.series.get(key);
    if (!s) { s = { points: [], gap: this.baseGapMs, firstAt: now }; this.series.set(key, s); }
    const last = s.points[s.points.length - 1];
    if (last && now - last.t < s.gap) return false;
    if (last && now < last.t) return false;
    s.points.push({ t: now, v: valueMB });
    if (s.points.length >= this.maxPoints) {
      // keep the newest point and every second one before it
      const kept = [];
      for (let i = s.points.length - 1; i >= 0; i -= 2) kept.push(s.points[i]);
      s.points = kept.reverse();
      s.gap *= 2;
    }
    return true;
  }

  forget(key) { this.series.delete(key); }

  /** Drops every series whose key is not in `liveKeys`. */
  prune(liveKeys) {
    const keep = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
    for (const k of [...this.series.keys()]) if (!keep.has(k)) this.series.delete(k);
  }

  points(key) { const s = this.series.get(key); return s ? s.points.slice() : []; }

  latest(key) { const s = this.series.get(key); return s && s.points.length ? s.points[s.points.length - 1].v : null; }

  /** Growth in MB/min over the last `windowMs`, ignoring the client's first 5 minutes unless `skipWarmup` is false. */
  slope(key, { windowMs = 15 * 60e3, now = Date.now(), skipWarmup = true } = {}) {
    const s = this.series.get(key);
    if (!s) return null;
    const from = Math.max(now - windowMs, skipWarmup ? s.firstAt + WARMUP_MS : -Infinity);
    return linearSlope(s.points.filter((p) => p.t >= from && p.t <= now));
  }

  /** Up to `n` values, oldest first, for a sparkline. */
  spark(key, n = 30) {
    const s = this.series.get(key);
    return s ? downsample(s.points.map((p) => p.v), n) : [];
  }
}

/**
 * What the table shows for one running client: { state, label }.
 * state is one of ok, launching, degraded, failed (the UI maps them to green, amber, amber, red).
 */
function classifyClient({ inst, now = Date.now(), loadingMs = 120000 }) {
  if (!inst) return { state: 'degraded', label: 'unknown' };
  const log = inst.log || null;
  if (log && log.disconnectedAt) {
    return { state: 'failed', label: `disconnected${log.reason ? ` (${log.reason})` : ''}` };
  }
  if (inst.hung) return { state: 'degraded', label: 'not responding' };
  const age = now - (inst.startedAt || now);
  if (age < loadingMs) return { state: 'launching', label: 'launching' };
  if (log && log.inGame === false) return { state: 'degraded', label: 'not in game' };
  return { state: 'ok', label: log && log.inGame ? 'in game' : 'running' };
}

/**
 * Fleet numbers for the health strip.
 * instances: [{ key, privMB }]; memory: { freeBytes, limitBytes } or null when the helper has not answered.
 * level: ok, watch or danger. Thresholds are defaults (see the constants), not measured limits.
 */
/** How many more clients fit above the free-commit reserve, at the size the running ones have reached (+15%). null when unknown. */
function roomForMore({ freeGB, keepFreeGB, perClientGB }) {
  if (typeof freeGB !== 'number' || !Number.isFinite(freeGB)) return null;
  if (typeof perClientGB !== 'number' || !Number.isFinite(perClientGB) || perClientGB <= 0) return null;
  return Math.max(0, Math.floor((freeGB - keepFreeGB) / (perClientGB * 1.15)));
}

/**
 * How many more clients the launch gate would let in: the same plan commitGate uses (limit minus the kept-back part, divided by
 * the larger of the biggest running client and the planning floor, plus 15%), minus the clients already running. null without a limit.
 */
function gateRoom({ limitGB, keepGB, running, peakGB, floorGB }) {
  if (typeof limitGB !== 'number' || !Number.isFinite(limitGB) || limitGB <= 0) return null;
  const per = Math.max(Number.isFinite(peakGB) ? peakGB : 0, floorGB) * 1.15;
  if (!(per > 0)) return null;
  return Math.max(0, Math.floor((limitGB - keepGB) / per) - (running || 0));
}

function fleetSummary({ instances, store, memory, now = Date.now(), keepFreeGB = DEFAULT_KEEP_FREE_GB, windowMs = 15 * 60e3 }) {
  const list = Array.isArray(instances) ? instances : [];
  let totalMB = 0;
  const slopes = [];
  for (const i of list) {
    if (finite(i.privMB)) totalMB += i.privMB;
    const s = store ? store.slope(i.key, { windowMs, now }) : null;
    if (finite(s)) slopes.push(s);
  }
  const freeGB = memory && finite(memory.freeBytes) && memory.freeBytes >= 0 ? memory.freeBytes / GB : null;
  const limitGB = memory && finite(memory.limitBytes) && memory.limitBytes > 0 ? memory.limitBytes / GB : null;
  const measured = slopes.length;
  const meanMBPerMin = measured ? slopes.reduce((a, b) => a + b, 0) / measured : null;
  // Fleet growth: only clients with a slope are counted, scaled to all running clients so one
  // freshly started client does not hide the rest.
  const gbPerHour = meanMBPerMin == null ? null : (Math.max(0, meanMBPerMin) * list.length * 60) / 1024;
  const hours = freeGB == null ? null : hoursToLimit({ freeGB, keepFreeGB, gbPerHour });
  let biggestMB = 0;
  for (const i of list) if (finite(i.privMB) && i.privMB > biggestMB) biggestMB = i.privMB;
  const perClientGB = biggestMB > 0 ? biggestMB / 1024 : null;
  let level = 'ok';
  if (freeGB != null) {
    if (freeGB < DANGER_FREE_GB || (hours != null && hours < DANGER_HOURS)) level = 'danger';
    else if (freeGB < WATCH_FREE_GB || (hours != null && hours < WATCH_HOURS)) level = 'watch';
  }
  return {
    clients: list.length,
    totalPrivGB: totalMB / 1024,
    freeGB, limitGB,
    meanMBPerMin, gbPerHour, hoursToLimit: hours,
    measuredClients: measured,
    trend: trendOf(meanMBPerMin),
    keepFreeGB,
    perClientGB,
    room: roomForMore({ freeGB, keepFreeGB, perClientGB }),
    level,
  };
}

module.exports = {
  MetricsStore, linearSlope, trendOf, hoursToLimit, downsample, classifyClient, fleetSummary, roomForMore, gateRoom,
  BASE_GAP_MS, MAX_POINTS, WARMUP_MS, FLAT_BELOW_MB_MIN, FAST_ABOVE_MB_MIN, DEFAULT_KEEP_FREE_GB,
};
