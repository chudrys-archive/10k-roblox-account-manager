'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('readJsonSafe moves an unreadable file aside instead of treating it as empty', () => {
  const { readJsonSafe } = require('../src/util');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-rj-'));
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, '{"fpsCap": 15,');
  const r = readJsonSafe(f, {});
  assert.deepStrictEqual(r.data, {});
  assert.ok(r.corrupt && fs.existsSync(r.corrupt), 'corrupt copy kept');
  assert.ok(!fs.existsSync(f), 'original moved away so a save cannot overwrite it silently');
  assert.strictEqual(fs.readFileSync(r.corrupt, 'utf8'), '{"fpsCap": 15,');
  const missing = readJsonSafe(path.join(dir, 'nope.json'), { a: 1 });
  assert.deepStrictEqual(missing, { data: { a: 1 }, corrupt: null });
  const ok = path.join(dir, 'ok.json'); fs.writeFileSync(ok, '{"x":2}');
  assert.deepStrictEqual(readJsonSafe(ok, {}).data, { x: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});
