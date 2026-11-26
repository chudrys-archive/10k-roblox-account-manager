'use strict';

/**
 * CPU use of one process as a share of the whole machine (the measure Task Manager shows), worked out from the
 * cumulative CPU time the process has used. Pure: the caller keeps `prev` between readings.
 *   prev    {ms, t} of the previous reading, or null
 *   cpuMs   cumulative CPU time now (ms), or null when it could not be read
 *   now     time of this reading (ms)
 *   cores   logical processor count
 *   prevPct the last smoothed value, or null
 * Returns { pct, prev }: pct is null until two readings at least half a second apart exist.
 */
function cpuShare(prev, cpuMs, now, cores, prevPct = null) {
  if (typeof cpuMs !== 'number' || !Number.isFinite(cpuMs) || cpuMs < 0) return { pct: prevPct, prev: prev || null };
  const cur = { ms: cpuMs, t: now };
  if (!prev) return { pct: prevPct, prev: cur };
  if (cpuMs < prev.ms) return { pct: prevPct, prev: cur }; // counter restarted: start over
  if (now - prev.t < 500) return { pct: prevPct, prev }; // too short a window to mean anything
  const raw = ((cpuMs - prev.ms) / (now - prev.t)) / Math.max(1, cores) * 100;
  const v = Math.min(100, Math.max(0, raw));
  const smoothed = prevPct == null ? v : prevPct * 0.5 + v * 0.5;
  return { pct: Math.round(smoothed * 10) / 10, prev: cur };
}

module.exports = { cpuShare };
