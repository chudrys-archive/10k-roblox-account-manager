'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, listProfiles, fromSettings, saveProfile, BUILTIN, KEYS } = require('../src/profiles');

test('sanitize keeps valid values and reports bad ones', () => {
  const r = sanitize({ graphicsApi: 'vulkan', fpsCap: 30, graphicsLevel: 11, clientPriority: 'Realtime', noPowerThrottle: 'yes', extra: 1 });
  assert.deepEqual(r.values, { graphicsApi: 'vulkan', fpsCap: 30 });
  assert.deepEqual(r.rejected.sort(), ['clientPriority', 'graphicsLevel', 'noPowerThrottle']);
});

test('every built-in profile is fully valid', () => {
  for (const [id, p] of Object.entries(BUILTIN)) {
    const s = sanitize(p.values);
    assert.deepEqual(s.rejected, [], id);
    assert.deepEqual(Object.keys(s.values).sort(), [...KEYS].sort(), id);
  }
});

test('saved profiles are listed after built-ins and re-sanitized', () => {
  const l = listProfiles([{ name: 'mine', values: { fpsCap: 20, graphicsApi: 'bogus' } }, { name: '  ', values: {} }, null]);
  assert.equal(l[0].id, 'default');
  const mine = l[l.length - 1];
  assert.equal(mine.id, 'saved:mine'); assert.deepEqual(mine.values, { fpsCap: 20 });
  assert.equal(l.length, Object.keys(BUILTIN).length + 1);
});

test('saveProfile replaces by name, caps the list, needs a name', () => {
  let s = saveProfile([], 'a', { fpsCap: 10 });
  s = saveProfile(s, 'a', { fpsCap: 20 });
  assert.deepEqual(s, [{ name: 'a', values: { fpsCap: 20 } }]);
  assert.throws(() => saveProfile(s, '  ', {}));
  let many = [];
  for (let i = 0; i < 25; i++) many = saveProfile(many, 'p' + i, {});
  assert.equal(many.length, 20); assert.equal(many[19].name, 'p24');
});

test('fromSettings picks only profile keys', () => {
  assert.deepEqual(fromSettings({ graphicsApi: 'd3d11', port: 7963, fpsCap: 0 }), { graphicsApi: 'd3d11', fpsCap: 0 });
});
