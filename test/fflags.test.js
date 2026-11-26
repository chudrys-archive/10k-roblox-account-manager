'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFlags, setFramerateCap } = require('../src/fflags');

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
test('fpsCap no longer goes into ClientAppSettings (Roblox denies it)', () => {
  assert.deepEqual(buildFlags({ fpsCap: 15 }), {});
});

test('setFramerateCap replaces an existing value', () => {
  const xml = '<roblox>\n  <Properties>\n    <int name="FramerateCap">-1</int>\n  </Properties>\n</roblox>';
  assert.match(setFramerateCap(xml, 15), /<int name="FramerateCap">15<\/int>/);
  assert.doesNotMatch(setFramerateCap(xml, 15), /-1/);
});

test('setFramerateCap inserts the value when it is missing', () => {
  const xml = '<roblox>\n  <Properties>\n    <int name="Other">1</int>\n  </Properties>\n</roblox>';
  const out = setFramerateCap(xml, 30);
  assert.match(out, /<int name="FramerateCap">30<\/int>\n  <\/Properties>/);
  assert.match(out, /<int name="Other">1<\/int>/);
});

test('setFramerateCap rejects bad caps and XML it cannot place the value in', () => {
  const xml = '<roblox><Properties>\n</Properties></roblox>';
  assert.equal(setFramerateCap(xml, 0), null);
  assert.equal(setFramerateCap(xml, NaN), null);
  assert.equal(setFramerateCap(xml, 5000), null);
  assert.equal(setFramerateCap('<roblox/>', 15), null);
});

const { applyClientSettings, setScalarProp, setVector2Prop } = require('../src/fflags');
const SAMPLE = '<roblox>\n\t<Item class="UserGameSettings">\n\t\t<Properties>\n\t\t\t<bool name="Fullscreen">true</bool>\n\t\t\t<int name="GraphicsQualityLevel">0</int>\n\t\t\t<bool name="StartMaximized">true</bool>\n\t\t\t<token name="SavedQualityLevel">0</token>\n\t\t\t<int name="QualityResetLevel">0</int>\n\t\t\t<bool name="MaxQualityEnabled">true</bool>\n\t\t\t<Vector2 name="StartScreenSize">\n\t\t\t\t<X>2576</X>\n\t\t\t\t<Y>1456</Y>\n\t\t\t</Vector2>\n\t\t</Properties>\n\t</Item>\n</roblox>';

test('applyClientSettings pins the graphics level and windows the client', () => {
  const out = applyClientSettings(SAMPLE, { graphicsLevel: 1, windowWidth: 640, windowHeight: 360 });
  assert.match(out, /<int name="GraphicsQualityLevel">1<\/int>/);
  assert.match(out, /<token name="SavedQualityLevel">1<\/token>/);
  assert.match(out, /<int name="QualityResetLevel">1<\/int>/);
  assert.match(out, /<bool name="MaxQualityEnabled">false<\/bool>/);
  assert.match(out, /<bool name="Fullscreen">false<\/bool>/);
  assert.match(out, /<bool name="StartMaximized">false<\/bool>/);
  assert.match(out, /<X>640<\/X>\s*<Y>360<\/Y>/);
  assert.doesNotMatch(out, /2576|1456/);
});

test('applyClientSettings leaves settings alone at 0 and rejects out-of-range values', () => {
  assert.equal(applyClientSettings(SAMPLE, {}), null);
  assert.equal(applyClientSettings(SAMPLE, { graphicsLevel: 11, windowWidth: 100, windowHeight: 100 }), null);
  assert.equal(applyClientSettings(SAMPLE, { graphicsLevel: NaN, windowWidth: 640, windowHeight: 0 }), null);
  const lvlOnly = applyClientSettings(SAMPLE, { graphicsLevel: 3 });
  assert.match(lvlOnly, /<int name="GraphicsQualityLevel">3<\/int>/);
  assert.match(lvlOnly, /<bool name="Fullscreen">true<\/bool>/);
  assert.match(lvlOnly, /2576/);
});

test('setScalarProp and setVector2Prop insert missing properties and return null without a Properties block', () => {
  const bare = '<roblox>\n\t\t<Properties>\n\t\t</Properties>\n</roblox>';
  assert.match(setScalarProp(bare, 'int', 'GraphicsQualityLevel', 2), /<int name="GraphicsQualityLevel">2<\/int>/);
  assert.match(setVector2Prop(bare, 'StartScreenSize', 800, 600), /<X>800<\/X>\s*<Y>600<\/Y>/);
  assert.equal(setScalarProp('<roblox/>', 'int', 'X', 1), null);
  assert.equal(setVector2Prop('<roblox/>', 'StartScreenSize', 1, 1), null);
});

test('window sizes far below the Roblox minimum are written to the settings file', () => {
  assert.ok(applyClientSettings(SAMPLE, { windowWidth: 320, windowHeight: 240 }));
  assert.ok(applyClientSettings(SAMPLE, { windowWidth: 120, windowHeight: 80 }));
  assert.equal(applyClientSettings(SAMPLE, { windowWidth: 119, windowHeight: 80 }), null);
});
