'use strict';

/**
 * One-click performance presets. Each preset is a plain set of settings values; nothing here touches the game.
 * "max" is for AFK farming with many clients, "balanced" for playing one client while others idle, "default" is Roblox as shipped.
 */
const PRESETS = [
  {
    id: 'main', name: 'Recommended: the author\'s main PC',
    blurb: 'The setup the author runs on his main PC for 8 AFK clients: 40 s sign-in gap, lowest graphics at 15 FPS in 320x240 windows, keep-alive watchdog with screen check and stall rule, captcha guard, low CPU priority and memory trim. Your accounts, webhook, executor and favorites are not touched.',
    settings: {
      multiInstance: true, launchDelaySec: 6, signInGapSec: 40, launchTimeoutSec: 90, noPowerThrottle: true, skipUpdateCheck: true, renameWindows: true,
      fastProfile: 'lowest', fpsCap: 15, graphicsLevel: 1, windowWidth: 320, windowHeight: 240,
      customFFlags: '{"DFIntDebugFRMQualityLevelOverride":1,"FIntFRMMinGrassDistance":0,"FIntFRMMaxGrassDistance":0,"DFIntCSGLevelOfDetailSwitchingDistance":0,"DFIntCSGLevelOfDetailSwitchingDistanceL12":0,"DFIntCSGLevelOfDetailSwitchingDistanceL23":0,"DFIntCSGLevelOfDetailSwitchingDistanceL34":0,"DFFlagDebugPauseVoxelizer":"True","FFlagDebugSkyGray":"True","FIntDebugForceMSAASamples":1}',
      clientPriority: 'BelowNormal', trimMemoryMin: 1, trimWhenFreeBelowPct: 50, cpuCapPct: 0, cpuCapSpareFront: true, closeAllKeepsMain: true, minimizedAction: 'leave',
      'watchdog.enabled': true, 'watchdog.resumeAfterRestart': true, 'watchdog.tickSec': 5, 'watchdog.presenceCheck': true, 'watchdog.presenceIntervalSec': 45,
      'watchdog.graceSec': 150, 'watchdog.badChecksToRestart': 2, 'watchdog.disconnectGraceSec': 25, 'watchdog.relaunchDelaySec': 15, 'watchdog.killHungAfterSec': 120,
      'watchdog.screenCheckSec': 60, 'watchdog.frozenMin': 20, 'watchdog.noJoinRestartMin': 35, 'watchdog.maxRelaunchesPerHour': 15, 'watchdog.fallbackToPublic': true,
      'watchdog.breakerDisconnects': 4, 'watchdog.breakerWindowMin': 20,
      'captchaGuard.enabled': true, 'captchaGuard.pauseAll': true,
    },
  },
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
  clientPriority: 'CPU priority', signInGapSec: 'Sign-in gap (s)', launchDelaySec: 'Launch delay (s)', launchTimeoutSec: 'Launch timeout (s)', noPowerThrottle: 'Disable power throttling', customFFlags: 'Custom FFlags',
  trimWhenFreeBelowPct: 'Trim only when free memory is below (%)', cpuCapSpareFront: 'Spare the front window from the CPU cap', closeAllKeepsMain: 'Close all keeps the main account',
  'watchdog.enabled': 'Watchdog', 'watchdog.screenCheckSec': 'Screen check (s)', 'watchdog.frozenMin': 'Frozen picture (min)', 'watchdog.noJoinRestartMin': 'No-join restart (min)', 'watchdog.killHungAfterSec': 'Kill hung after (s)', 'captchaGuard.enabled': 'Captcha guard', trimMemoryMin: 'Memory trim (min)', cpuCapPct: 'CPU cap per background client (%)', minimizedAction: 'Minimized windows',
};

/** Dotted keys ('watchdog.tickSec') address nested settings. */
const getPath = (obj, key) => key.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
/** A preset's flat key list as the nested patch Settings.update expects. */
function expandPreset(flat) {
  const out = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.');
    let o = out;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = val;
  }
  return out;
}

const byId = (id) => PRESETS.find((p) => p.id === id) || null;

/** The preset whose values all equal the current settings, or 'custom'. */
function matchPreset(settings) {
  const s = settings || {};
  for (const p of PRESETS) {
    if (Object.keys(p.settings).every((k) => (getPath(s, k) === undefined ? false : getPath(s, k) === p.settings[k]))) return p.id;
  }
  return 'custom';
}

/** What applying a preset would change: [{ key, label, from, to }]. Empty when nothing differs. */
function diffPreset(settings, id) {
  const p = byId(id);
  if (!p) return [];
  const s = settings || {};
  return Object.keys(p.settings).filter((k) => getPath(s, k) !== p.settings[k]).map((k) => ({ key: k, label: LABELS[k] || k, from: getPath(s, k), to: p.settings[k] }));
}

module.exports = { PRESETS, LABELS, byId, matchPreset, diffPreset, expandPreset };
