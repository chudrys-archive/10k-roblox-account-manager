'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-tray-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { Settings, DEFAULTS } = require('../src/settings');
const { Tray } = require('../src/tray');

test('tray defaults: icon on, no hotkeys', () => {
  assert.deepEqual(DEFAULTS.tray, { enabled: true, hotkeyOpen: '', hotkeyCloseAll: '' });
});

test('settings store hotkeys in normalized form and refuse bad ones', () => {
  const s = new Settings();
  s.update({ tray: { hotkeyOpen: 'alt+control+m', hotkeyCloseAll: 'Win+F9' } });
  assert.equal(s.get('tray').hotkeyOpen, 'Ctrl+Alt+M');
  assert.equal(s.get('tray').hotkeyCloseAll, 'Win+F9');
  assert.throws(() => s.update({ tray: { hotkeyOpen: 'Shift+M' } }), /Ctrl, Alt or Win/);
  assert.throws(() => s.update({ tray: { hotkeyOpen: 'Ctrl+K', hotkeyCloseAll: 'ctrl+k' } }), /different hotkeys/);
  assert.equal(s.get('tray').hotkeyOpen, 'Ctrl+Alt+M', 'a refused update leaves the saved value alone');
  s.update({ tray: { enabled: false, hotkeyOpen: '', hotkeyCloseAll: '' } });
  assert.deepEqual(s.get('tray'), { enabled: false, hotkeyOpen: '', hotkeyCloseAll: '' });
});

test('Tray.apply validates before doing anything and never spawns when disabled', () => {
  const t = new Tray({ script: 'does-not-exist.ps1' });
  assert.throws(() => t.apply({ enabled: true, hotkeyOpen: 'M' }), /modifier and a key/);
  assert.equal(t.proc, null);
  t.apply({ enabled: false, hotkeyOpen: 'Ctrl+Alt+M' });
  assert.equal(t.proc, null);
  assert.deepEqual(t.publicView(), { running: false, error: '', hotkeys: { open: { label: 'Ctrl+Alt+M', ok: null } } });
});
