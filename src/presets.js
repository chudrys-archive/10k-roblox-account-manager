'use strict';

/**
 * One-click performance presets. Each preset is a plain set of settings values; nothing here touches the game.
 * "max" is for AFK farming with many clients, "balanced" for playing one client while others idle, "default" is Roblox as shipped.
 */
const PRESETS = [
  {
    id: 'max', name: 'Max alts',
    blurb: 'Smallest windows, lowest graphics, 15 FPS and a CPU cap on background clients. Fits the most clients on one PC; built for AFK farming.',
    settings: { fpsCap: 15, graphicsLevel: 1, fastProfile: 'lowest', windowWidth: 320, windowHeight: 240, clientPriority: 'BelowNormal', trimMemoryMin: 15, cpuCapPct: 5, minimizedAction: 'park' },
  },
  {
    id: 'balanced', name: 'Balanced',
    blurb: '30 FPS, low graphics and mid-size windows. Good when you watch a few clients and the rest idle.',
    settings: { fpsCap: 30, graphicsLevel: 3, fastProfile: 'low', windowWidth: 640, windowHeight: 360, clientPriority: 'Normal', trimMemoryMin: 0, cpuCapPct: 0, minimizedAction: 'leave' },
  },
  {
    id: 'default', name: 'Roblox defaults',
    blurb: 'Nothing limited: Roblox picks its own FPS, graphics and window size. One or two clients that you actually play.',
    settings: { fpsCap: 0, graphicsLevel: 0, fastProfile: 'off', windowWidth: 0, windowHeight: 0, clientPriority: 'Normal', trimMemoryMin: 0, cpuCapPct: 0, minimizedAction: 'leave' },
  },
];

const LABELS = {
  fpsCap: 'FPS cap', graphicsLevel: 'Graphics quality', fastProfile: 'Textures', windowWidth: 'Window width', windowHeight: 'Window height',
  clientPriority: 'CPU priority', trimMemoryMin: 'Memory trim (min)', cpuCapPct: 'CPU cap per background client (%)', minimizedAction: 'Minimized windows',
};

const byId = (id) => PRESETS.find((p) => p.id === id) || null;

/** The preset whose values all equal the current settings, or 'custom'. */
function matchPreset(settings) {
  const s = settings || {};
  for (const p of PRESETS) {
    if (Object.keys(p.settings).every((k) => (s[k] === undefined ? false : s[k] === p.settings[k]))) return p.id;
  }
  return 'custom';
}

/** What applying a preset would change: [{ key, label, from, to }]. Empty when nothing differs. */
function diffPreset(settings, id) {
  const p = byId(id);
  if (!p) return [];
  const s = settings || {};
  return Object.keys(p.settings).filter((k) => s[k] !== p.settings[k]).map((k) => ({ key: k, label: LABELS[k] || k, from: s[k], to: p.settings[k] }));
}

module.exports = { PRESETS, LABELS, byId, matchPreset, diffPreset };
