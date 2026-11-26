'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFlags, parseGraphicsApi, GRAPHICS_APIS } = require('../src/fflags');

test('auto writes no graphics flag, named APIs write exactly one', () => {
  assert.deepEqual(buildFlags({ graphicsApi: 'auto' }), {});
  assert.deepEqual(buildFlags({ graphicsApi: 'vulkan' }), { FFlagDebugGraphicsPreferVulkan: 'True' });
  assert.deepEqual(buildFlags({ graphicsApi: 'opengl' }), { FFlagDebugGraphicsPreferOpenGL: 'True' });
  assert.deepEqual(buildFlags({ graphicsApi: 'd3d11' }), { FFlagDebugGraphicsPreferD3D11: 'True' });
  assert.deepEqual(buildFlags({ graphicsApi: 'nonsense' }), {});
  assert.deepEqual(Object.keys(GRAPHICS_APIS).sort(), ['auto', 'd3d11', 'opengl', 'vulkan']);
});

test('graphics API combines with the preset and custom flags, custom wins', () => {
  const f = buildFlags({ fastProfile: 'low', graphicsApi: 'vulkan', customFFlags: '{"FFlagDebugGraphicsPreferVulkan":"False"}' });
  assert.equal(f.DFIntTextureQualityOverride, 1);
  assert.equal(f.FFlagDebugGraphicsPreferVulkan, 'False');
});

test('parseGraphicsApi reads the confirmed D3D11 log line and ignores others', () => {
  const real = '2026-11-25T03:06:40.949Z,0.949786,1534,6 [FLog::Graphics] D3D11 Adapter: AMD Radeon RX 9060 XT';
  assert.equal(parseGraphicsApi(real), 'd3d11');
  assert.equal(parseGraphicsApi('2026-11-25T03:06:40.959Z,0.959758,1534,6,Warning [FLog::Graphics] D3D11: GfxCardName AMD'), null);
  assert.equal(parseGraphicsApi('2026-11-25T03:21:30.015Z,1.015027,477c,6 [FLog::Graphics] Vulkan Device: AMD Radeon RX 9060 XT'), 'vulkan');
  assert.equal(parseGraphicsApi('[FLog::Graphics] Vulkan: Using extension: VK_KHR_surface'), null);
  assert.equal(parseGraphicsApi('unrelated line'), null);
  assert.equal(parseGraphicsApi(''), null);
});
