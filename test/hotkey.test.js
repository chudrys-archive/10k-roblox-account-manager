'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHotkey, hotkeyConflict, MOD } = require('../src/hotkey');

test('blank means no hotkey', () => {
  assert.equal(parseHotkey(''), null);
  assert.equal(parseHotkey('   '), null);
  assert.equal(parseHotkey(undefined), null);
});

test('parses letters, digits and function keys', () => {
  assert.deepEqual(parseHotkey('Ctrl+Alt+M'), { mods: MOD.ctrl | MOD.alt, vk: 0x4d, label: 'Ctrl+Alt+M' });
  assert.deepEqual(parseHotkey('ctrl + shift + 7'), { mods: MOD.ctrl | MOD.shift, vk: 0x37, label: 'Ctrl+Shift+7' });
  assert.equal(parseHotkey('Win+F1').vk, 0x70);
  assert.equal(parseHotkey('Alt+F24').vk, 0x87);
});

test('label is normalized whatever the input order and case', () => {
  assert.equal(parseHotkey('m+alt+CTRL'.split('+').reverse().join('+')).label, 'Ctrl+Alt+M');
  assert.equal(parseHotkey('Alt+Control+k').label, 'Ctrl+Alt+K');
  assert.equal(parseHotkey('Windows+Shift+x').label, 'Shift+Win+X');
});

test('rejects hotkeys that would hijack normal typing or are malformed', () => {
  assert.throws(() => parseHotkey('M'), /modifier and a key/);
  assert.throws(() => parseHotkey('Shift+M'), /Ctrl, Alt or Win/);
  assert.throws(() => parseHotkey('Ctrl+Alt'), /not a key|must be A-Z/);
  assert.throws(() => parseHotkey('Ctrl+Foo+M'), /not a modifier/);
  assert.throws(() => parseHotkey('Ctrl+Space'), /A-Z, 0-9 or F1-F24/);
  assert.throws(() => parseHotkey('Ctrl+F25'), /A-Z, 0-9 or F1-F24/);
});

test('detects the same hotkey on two actions', () => {
  const a = parseHotkey('Ctrl+Alt+M');
  assert.match(hotkeyConflict(a, parseHotkey('alt+ctrl+m')), /different hotkeys/);
  assert.equal(hotkeyConflict(a, parseHotkey('Ctrl+Alt+N')), '');
  assert.equal(hotkeyConflict(a, null), '');
});
