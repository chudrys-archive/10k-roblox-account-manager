'use strict';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (t) => { const m = HHMM.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Pure: "1234567" style text or an array to a sorted unique list of weekdays (0 = Sunday .. 6 = Saturday); 7 is read as Sunday. */
function parseDays(v) {
  const raw = Array.isArray(v) ? v.map(String).join('') : String(v ?? '');
  const out = new Set();
  for (const ch of raw) if (/[0-7]/.test(ch)) out.add(Number(ch) % 7);
  return [...out].sort((a, b) => a - b);
}

/** Pure: cleans a schedule config. Invalid times fall back to a full-day window rather than a silent never-run. */
function normalize(cfg) {
  const c = cfg || {};
  const start = toMin(c.start) === null ? '00:00' : c.start;
  const end = toMin(c.end) === null ? '00:00' : c.end;
  const days = parseDays(c.days);
  return { enabled: !!c.enabled, start, end, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], closeAtEnd: !!c.closeAtEnd };
}

/**
 * Pure: is automation allowed at `now` (a Date, local time)? Disabled schedule = always. start === end means all day.
 * A window that crosses midnight belongs to the day it started on (22:00-02:00 on Friday runs until Saturday 02:00).
 */
function isActive(cfg, now = new Date()) {
  const c = normalize(cfg);
  if (!c.enabled) return true;
  const a = toMin(c.start); const b = toMin(c.end);
  if (a === b) return c.days.includes(now.getDay());
  const m = now.getHours() * 60 + now.getMinutes();
  if (a < b) return c.days.includes(now.getDay()) && m >= a && m < b;
  if (m >= a) return c.days.includes(now.getDay());
  if (m < b) return c.days.includes((now.getDay() + 6) % 7);
  return false;
}

module.exports = { parseDays, normalize, isActive, toMin };
