'use strict';
// Pure: builds the flags written into ClientAppSettings.json. No I/O, no Roblox paths.
// Roblox's FastFlag allowlist (announced 2025-09-29) only honours a subset of flags locally.
// The texture quality flags are on the published allowlist. FFlagDisablePostFx is from
// community lists and is not confirmed on the allowlist: Roblox may ignore it.

const PROFILES = {
  off: {},
  low: {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: 1,
  },
  lowest: {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: 0,
    FFlagDisablePostFx: 'True',
  },
};

function buildFlags({ fastProfile = 'off', fpsCap = 0, customFFlags = '' } = {}) {
  const flags = { ...(PROFILES[fastProfile] || PROFILES.off) };
  if (fpsCap) flags.DFIntTaskSchedulerTargetFps = fpsCap;
  if (customFFlags) Object.assign(flags, JSON.parse(customFFlags));
  return flags;
}

module.exports = { buildFlags, PROFILES };
