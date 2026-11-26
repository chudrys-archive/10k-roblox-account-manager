'use strict';

// A launch profile is a named bundle of the settings that change how a client runs. It holds no game data:
// every value is an existing manager setting, validated again by Settings.update when applied.
const KEYS = ['graphicsApi', 'fastProfile', 'fpsCap', 'graphicsLevel', 'clientPriority', 'noPowerThrottle', 'minimizedAction'];

const ENUMS = {
  graphicsApi: ['auto', 'd3d11', 'vulkan', 'opengl'],
  fastProfile: ['off', 'low', 'lowest'],
  clientPriority: ['Normal', 'BelowNormal', 'Idle'],
  minimizedAction: ['leave', 'park'],
};

// Built-ins are starting points, not measured recommendations: use the Experiments page to check any of them.
const BUILTIN = {
  default: { label: 'Default (change nothing)', values: { graphicsApi: 'auto', fastProfile: 'off', fpsCap: 0, graphicsLevel: 0, clientPriority: 'Normal', noPowerThrottle: false, minimizedAction: 'leave' } },
  light: { label: 'Light (low textures, 30 FPS, quality level 1)', values: { graphicsApi: 'auto', fastProfile: 'low', fpsCap: 30, graphicsLevel: 1, clientPriority: 'BelowNormal', noPowerThrottle: true, minimizedAction: 'park' } },
  lightest: { label: 'Lightest (lowest textures, 15 FPS, quality level 1)', values: { graphicsApi: 'auto', fastProfile: 'lowest', fpsCap: 15, graphicsLevel: 1, clientPriority: 'BelowNormal', noPowerThrottle: true, minimizedAction: 'park' } },
};

/** Pure: keeps only known keys with valid values. Returns { values, rejected: [key] }. */
function sanitize(values) {
  const out = {};
  const rejected = [];
  for (const k of KEYS) {
    if (!values || !(k in values)) continue;
    const v = values[k];
    if (ENUMS[k]) { if (ENUMS[k].includes(v)) out[k] = v; else rejected.push(k); continue; }
    if (k === 'noPowerThrottle') { if (typeof v === 'boolean') out[k] = v; else rejected.push(k); continue; }
    const n = Number(v);
    const max = k === 'fpsCap' ? 1000 : 10;
    if (Number.isFinite(n) && n >= 0 && n <= max) out[k] = Math.trunc(n); else rejected.push(k);
  }
  return { values: out, rejected };
}

/** Pure: the profile list (built-ins first, then saved ones). */
function listProfiles(saved) {
  const list = Object.entries(BUILTIN).map(([id, p]) => ({ id, label: p.label, builtin: true, values: p.values }));
  for (const p of Array.isArray(saved) ? saved : []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
    const s = sanitize(p.values);
    list.push({ id: 'saved:' + p.name.trim(), label: p.name.trim(), builtin: false, values: s.values });
  }
  return list;
}

/** Pure: the current settings as profile values. */
function fromSettings(settings) {
  const v = {};
  for (const k of KEYS) if (settings && k in settings) v[k] = settings[k];
  return sanitize(v).values;
}

/** Pure: the saved list after adding or replacing a profile by name (max 20, name up to 40 characters). */
function saveProfile(saved, name, values) {
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) throw new Error('give the profile a name');
  const list = (Array.isArray(saved) ? saved : []).filter((p) => p && p.name !== nm);
  list.push({ name: nm, values: sanitize(values).values });
  return list.slice(-20);
}

const CODE_PREFIX = 'IRAM1:';

/** Pure: a profile as a short text code that can be pasted into chat. Holds only the whitelisted run settings. */
function encodeProfile(name, values) {
  const body = JSON.stringify({ n: String(name || '').trim().slice(0, 40), v: sanitize(values).values });
  return CODE_PREFIX + Buffer.from(body, 'utf8').toString('base64url');
}

/** Pure: reads a code made by encodeProfile. Throws a readable error for anything else. Unknown or invalid values are dropped. */
function decodeProfile(code) {
  const text = String(code || '').trim();
  if (!text.startsWith(CODE_PREFIX)) throw new Error('that is not a profile code (it should start with ' + CODE_PREFIX + ')');
  if (text.length > 2000) throw new Error('that code is too long to be a profile');
  let obj;
  try { obj = JSON.parse(Buffer.from(text.slice(CODE_PREFIX.length), 'base64url').toString('utf8')); } catch { throw new Error('the code is damaged: copy it again in full'); }
  if (!obj || typeof obj !== 'object' || typeof obj.v !== 'object' || !obj.v) throw new Error('the code is damaged: copy it again in full');
  const s = sanitize(obj.v);
  if (!Object.keys(s.values).length) throw new Error('the code has no usable settings');
  return { name: String(obj.n || '').trim().slice(0, 40), values: s.values, rejected: s.rejected };
}

module.exports = { KEYS, BUILTIN, sanitize, listProfiles, fromSettings, saveProfile, encodeProfile, decodeProfile };
