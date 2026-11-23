'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFlags } = require('../src/fflags');

test('custom FFlags merge over the profile', () => {
  const f = buildFlags({ fastProfile: 'low', customFFlags: '{"DFIntX":1}' });
  assert.equal(f.DFIntX, 1);
  assert.equal(f.DFIntTextureQualityOverride, 1);
});

test('invalid custom FFlags JSON is ignored instead of breaking launches', () => {
  assert.deepEqual(buildFlags({ customFFlags: '{bad' }), {});
});

test('the default profile writes nothing', () => {
  assert.deepEqual(buildFlags({}), {});
});