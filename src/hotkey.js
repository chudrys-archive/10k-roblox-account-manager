'use strict';

/**
 * Global hotkey text ("Ctrl+Alt+M") to the numbers Windows RegisterHotKey wants.
 * Pure, so it can be checked without a desktop. A hotkey needs Ctrl, Alt or Win: a bare key or Shift+key
 * would take over normal typing system-wide.
 */
const MOD = { alt: 0x1, ctrl: 0x2, shift: 0x4, win: 0x8 };
const MOD_ALIASES = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', win: 'win', windows: 'win', super: 'win', meta: 'win' };
const MOD_ORDER = [['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift'], ['win', 'Win']];

/** Returns { mods, vk, label } for valid text, null for blank text. Throws an Error with a plain message otherwise. */
function parseHotkey(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error(`Hotkey "${raw}" needs a modifier and a key, for example Ctrl+Alt+M`);
  const keyPart = parts[parts.length - 1];
  const seen = new Set();
  for (const p of parts.slice(0, -1)) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (!m) throw new Error(`Hotkey "${raw}": "${p}" is not a modifier (use Ctrl, Alt, Shift or Win)`);
    seen.add(m);
  }
  if (!(seen.has('ctrl') || seen.has('alt') || seen.has('win'))) throw new Error(`Hotkey "${raw}" needs Ctrl, Alt or Win so it does not take over normal typing`);
  let vk; let keyLabel;
  const k = keyPart.toUpperCase();
  if (/^[A-Z]$/.test(k)) { vk = k.charCodeAt(0); keyLabel = k; }
  else if (/^[0-9]$/.test(k)) { vk = k.charCodeAt(0); keyLabel = k; }
  else if (/^F([1-9]|1\d|2[0-4])$/.test(k)) { vk = 0x70 + Number(k.slice(1)) - 1; keyLabel = k; }
  else throw new Error(`Hotkey "${raw}": the key must be A-Z, 0-9 or F1-F24`);
  let mods = 0;
  for (const m of seen) mods |= MOD[m];
  const label = [...MOD_ORDER.filter(([id]) => seen.has(id)).map(([, name]) => name), keyLabel].join('+');
  return { mods, vk, label };
}

/** Same hotkey on two actions cannot work; returns an error message or ''. */
function hotkeyConflict(a, b) {
  return a && b && a.mods === b.mods && a.vk === b.vk ? `Both actions use ${a.label}; give them different hotkeys` : '';
}

module.exports = { parseHotkey, hotkeyConflict, MOD };
