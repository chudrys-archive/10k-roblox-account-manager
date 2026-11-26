'use strict';

// Pure: decides which client to trim next, so memory trims are spread over the interval instead of hitting every client at once.
// A trim empties a client's working set; the client then pages its memory back in, so trimming many clients in the same moment
// means a burst of page faults and disk writes. One client per step, at least MIN_GAP_MS apart, spaced evenly over the interval.

const MIN_GAP_MS = 5000;  // trims never overlap and are at least this far apart (one trim burst lasts about 3 s), so 6 clients fit a 30 s interval and 12 clients a 60 s one
const MIN_WS_MB = 700;     // a client holding less real RAM than this has little to give back
const REGROW_MB = 250;    // after a trim, wait until the client's RAM has grown by at least this much (or REGROW_PCT of its post-trim size)
const REGROW_PCT = 0.3;

/**
 * instances: [{ pid, startedAt }], trimmedAt: Map(pid -> time of that client's last trim).
 * Returns the pid to trim now, or null. A client is due once trimMin minutes have passed since its last trim (or since it started).
 * The most overdue client goes first; the gap between two trims is trimMin / client count, never below MIN_GAP_MS.
 * Every trim makes the client page its hot memory back in, which costs CPU, so a due client is skipped when there is nothing to gain:
 * its RAM (memMB) is under MIN_WS_MB, or it has not regrown since its last trim (trimBaseMB = its RAM measured just after that trim).
 * A client whose RAM is not known yet is treated as worth trimming.
 */
function pickTrim(instances, { now, trimMin, lastTrimAt = 0, trimmedAt = new Map() } = {}) {
  const interval = Number(trimMin) * 60000;
  if (!Number.isFinite(interval) || interval <= 0 || !Array.isArray(instances) || !instances.length) return null;
  const gap = Math.max(MIN_GAP_MS, Math.floor(interval / instances.length));
  if (now - lastTrimAt < gap) return null;
  let best = null;
  let bestBase = Infinity;
  for (const inst of instances) {
    if (!inst || !Number.isFinite(inst.pid)) continue;
    const base = trimmedAt.has(inst.pid) ? trimmedAt.get(inst.pid) : (Number.isFinite(inst.startedAt) ? inst.startedAt : now);
    if (now - base < interval || base >= bestBase) continue;
    if (!worthTrimming(inst)) continue;
    best = inst.pid; bestBase = base;
  }
  return best;
}

function worthTrimming(inst) {
  const ram = inst.memMB;
  if (!Number.isFinite(ram)) return true;
  if (ram < MIN_WS_MB) return false;
  const base = inst.trimBaseMB;
  if (!Number.isFinite(base)) return true;
  return ram - base >= Math.max(REGROW_MB, base * REGROW_PCT);
}
/**
 * True when RAM is tight enough that trimming is worth its CPU cost: free physical RAM is below belowPct percent of the total.
 * 100 = always trim; anything unreadable counts as tight so a failed read never switches trimming off.
 */
function ramIsTight(freeBytes, totalBytes, belowPct) {
  const pct = Number(belowPct);
  if (!Number.isFinite(pct) || pct >= 100) return true;
  if (!(freeBytes >= 0) || !(totalBytes > 0)) return true;
  return (freeBytes / totalBytes) * 100 < pct;
}
module.exports = { pickTrim, worthTrimming, ramIsTight, MIN_GAP_MS, MIN_WS_MB, REGROW_MB, REGROW_PCT };