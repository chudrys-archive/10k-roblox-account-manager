'use strict';

const FPS_MIN = 15; const FPS_MAX = 360;

/**
 * Per-account performance override. Every field is optional; 0 / missing means "use the global setting".
 * Returns a cleaned object, or null when nothing is overridden.
 */
function sanitizePerf(p) {
  if (!p || typeof p !== 'object') return null;
  const int = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
  let fpsCap = int(p.fpsCap);
  if (fpsCap < FPS_MIN || fpsCap > FPS_MAX) fpsCap = 0;
  let graphicsLevel = int(p.graphicsLevel);
  if (graphicsLevel < 1 || graphicsLevel > 10) graphicsLevel = 0;
  let windowWidth = int(p.windowWidth); let windowHeight = int(p.windowHeight);
  if (windowWidth < 120 || windowHeight < 80 || windowWidth > 7680 || windowHeight > 4320) { windowWidth = 0; windowHeight = 0; }
  if (!fpsCap && !graphicsLevel && !windowWidth) return null;
  return { fpsCap, graphicsLevel, windowWidth, windowHeight };
}

/** The values a client of this account should run with: the account's override where set, else the global setting. */
function effectivePerf(global, accountPerf) {
  const g = global || {};
  const o = sanitizePerf(accountPerf) || {};
  const num = (v) => Number(v) || 0;
  return {
    fpsCap: o.fpsCap || num(g.fpsCap),
    graphicsLevel: o.graphicsLevel || num(g.graphicsLevel),
    windowWidth: o.windowWidth || num(g.windowWidth),
    windowHeight: o.windowHeight || num(g.windowHeight),
  };
}

module.exports = { sanitizePerf, effectivePerf, FPS_MIN, FPS_MAX };
