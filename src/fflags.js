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

// Roblox denies DFIntTaskSchedulerTargetFps in local ClientAppSettings.json ("Denied local configuration" in the
// client log), so the frame cap is applied through the user setting FramerateCap in GlobalBasicSettings_*.xml instead.
const FRAMERATE_CAP_RE = /<int name="FramerateCap">[^<]*<\/int>/;

/** Pure: returns the XML with FramerateCap set to cap, or null when the XML has no <Properties> block to put it in. */
function setFramerateCap(xml, cap) {
  const n = Math.trunc(Number(cap));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return null;
  const el = '<int name="FramerateCap">' + n + '</int>';
  if (FRAMERATE_CAP_RE.test(xml)) return xml.replace(FRAMERATE_CAP_RE, el);
  const m = /^([ \t]*)<\/Properties>/m.exec(xml);
  if (!m) return null;
  return xml.slice(0, m.index) + m[1] + '  ' + el + '\n' + xml.slice(m.index);
}

const PROPS_CLOSE_RE = /^([ \t]*)<\/Properties>/m;
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Pure: sets <tag name="name">value</tag> inside the first <Properties> block (replaces or inserts). Null when there is no block. */
function setScalarProp(xml, tag, name, value) {
  const el = '<' + tag + ' name="' + name + '">' + value + '</' + tag + '>';
  const re = new RegExp('<' + tag + ' name="' + escRe(name) + '">[^<]*</' + tag + '>');
  if (re.test(xml)) return xml.replace(re, () => el);
  const m = PROPS_CLOSE_RE.exec(xml);
  if (!m) return null;
  return xml.slice(0, m.index) + m[1] + '  ' + el + '\n' + xml.slice(m.index);
}

/** Pure: sets a <Vector2 name="..."> property (replaces or inserts). Null when there is no block. */
function setVector2Prop(xml, name, x, y) {
  const re = new RegExp('<Vector2 name="' + escRe(name) + '">[\\s\\S]*?</Vector2>');
  const block = (ind) => ind + '<Vector2 name="' + name + '">\n' + ind + '  <X>' + x + '</X>\n' + ind + '  <Y>' + y + '</Y>\n' + ind + '</Vector2>';
  const found = re.exec(xml);
  if (found) {
    const ls = xml.lastIndexOf('\n', found.index) + 1;
    const ind = /^[ \t]*$/.test(xml.slice(ls, found.index)) ? xml.slice(ls, found.index) : '';
    return xml.slice(0, found.index) + block(ind).slice(ind.length) + xml.slice(found.index + found[0].length);
  }
  const m = PROPS_CLOSE_RE.exec(xml);
  if (!m) return null;
  return xml.slice(0, m.index) + block(m[1] + '  ') + '\n' + xml.slice(m.index);
}

const GRAPHICS_LEVEL_MAX = 10;
const WINDOW_MIN = { w: 120, h: 80 }; // Roblox itself will not go below 800x600, the manager shrinks the window afterwards (winhelper 'resize')
const WINDOW_MAX = { w: 7680, h: 4320 };

/**
 * Pure: applies per-client resource settings to GlobalBasicSettings XML. graphicsLevel 1-10 pins the quality level instead of
 * "Automatic" (0 in the file); a window size turns off fullscreen/maximized and sets StartScreenSize. 0 or missing leaves a
 * setting alone. Returns null when nothing valid was asked for or the XML has no <Properties> block.
 */
function applyClientSettings(xml, { graphicsLevel = 0, windowWidth = 0, windowHeight = 0 } = {}) {
  let out = xml;
  let changed = false;
  const lvl = Math.trunc(Number(graphicsLevel));
  if (Number.isFinite(lvl) && lvl >= 1 && lvl <= GRAPHICS_LEVEL_MAX) {
    for (const [tag, name, val] of [['int', 'GraphicsQualityLevel', lvl], ['token', 'SavedQualityLevel', lvl], ['int', 'QualityResetLevel', lvl], ['bool', 'MaxQualityEnabled', 'false']]) {
      out = setScalarProp(out, tag, name, val);
      if (out === null) return null;
    }
    changed = true;
  }
  const w = Math.trunc(Number(windowWidth));
  const h = Math.trunc(Number(windowHeight));
  if (Number.isFinite(w) && Number.isFinite(h) && w >= WINDOW_MIN.w && h >= WINDOW_MIN.h && w <= WINDOW_MAX.w && h <= WINDOW_MAX.h) {
    for (const [name, val] of [['Fullscreen', 'false'], ['StartMaximized', 'false']]) {
      out = setScalarProp(out, 'bool', name, val);
      if (out === null) return null;
    }
    out = setVector2Prop(out, 'StartScreenSize', w, h);
    if (out === null) return null;
    changed = true;
  }
  return changed ? out : null;
}
// Graphics API choice. Flag names are the ones listed on public allowlist threads (Sober docs, Bloxstrap issue 5897):
// they are honoured only while Roblox keeps them on the allowlist, so the client log is the proof (see parseGraphicsApi).
const GRAPHICS_APIS = {
  auto: {},
  d3d11: { FFlagDebugGraphicsPreferD3D11: 'True' },
  vulkan: { FFlagDebugGraphicsPreferVulkan: 'True' },
  opengl: { FFlagDebugGraphicsPreferOpenGL: 'True' },
};

/**
 * Pure: reads which graphics API a client started with from a log line. Only the D3D11 line shape
 * ("[FLog::Graphics] D3D11 Adapter: ...") and the Vulkan one ("[FLog::Graphics] Vulkan Device: ...") are confirmed on
 * Roblox 0.748.0.7481526 on this PC; OpenGL is matched by the same pattern and stays unconfirmed until seen in a real log.
 */
function parseGraphicsApi(line) {
  const m = /\[FLog::Graphics\]\s+(D3D11|D3D10|Vulkan|OpenGL)\s+(?:Adapter|Device):/i.exec(String(line));
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === 'd3d10' ? 'd3d10' : v;
}

function buildFlags({ fastProfile = 'off', customFFlags = '', graphicsApi = 'auto' } = {}) {
  const flags = { ...(PROFILES[fastProfile] || PROFILES.off), ...(GRAPHICS_APIS[graphicsApi] || {}) };
  if (customFFlags) {
    // settings reject invalid JSON on save; a hand-edited file must not break every launch
    try {
      const extra = JSON.parse(customFFlags);
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(flags, extra);
    } catch { /* ignored */ }
  }
  return flags;
}

module.exports = { GRAPHICS_APIS, parseGraphicsApi, buildFlags, setFramerateCap, applyClientSettings, setScalarProp, setVector2Prop, PROFILES };
