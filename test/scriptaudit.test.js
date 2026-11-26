'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { auditSource, auditPath, stripCode } = require('../src/scriptaudit');

const rules = (src) => auditSource(src).map((f) => `${f.line}:${f.rule}`);

test('comments and strings do not count as code', () => {
  const out = stripCode("local s = 'while true do'\n-- while true do end\n--[[ while true do\nend ]]\nx = 1");
  assert.ok(!/while/.test(out));
  assert.equal(out.split('\n').length, 5, 'line numbers are kept');
});

test('a never-ending loop without a wait is reported, with a wait it is not', () => {
  assert.deepEqual(rules('while true do\n  print(1)\nend'), ['1:noWait', '2:printInLoop']);
  assert.deepEqual(rules('while true do\n  task.wait(1)\nend'), []);
  assert.deepEqual(rules('while true do task.wait() end'), [], 'one-line loop');
  assert.deepEqual(rules('while true do\n  RunService.Heartbeat:Wait()\nend'), []);
});

test('the wait of an inner block counts for the loop around it', () => {
  assert.deepEqual(rules('while true do\n  if x then\n    wait(2)\n  end\nend'), []);
});

test('a connection made in a loop is a warning, a loose connection a note, a stored one nothing', () => {
  assert.deepEqual(rules('for i = 1, 5 do\n  RunService.Heartbeat:Connect(function() end)\nend'), ['2:connectInLoop']);
  assert.deepEqual(rules('RunService.Heartbeat:Connect(function() end)'), ['1:looseConnect']);
  assert.deepEqual(rules('local c = RunService.Heartbeat:Connect(function() end)'), []);
  assert.deepEqual(rules('conns[#conns + 1] = RunService.Stepped:Connect(f)'), []);
});

test('downloads and whole-game scans inside a loop are reported', () => {
  const r = rules('while true do\n  loadstring(game:HttpGet("u"))()\n  local g = getgc()\n  task.wait(5)\nend');
  assert.deepEqual(r, ['2:httpInLoop', '3:heavyScan']);
  assert.deepEqual(rules('local g = getgc()'), [], 'a single scan outside a loop is fine');
});

test('objects that are created and never destroyed are reported once, for the first line', () => {
  const lines = Array.from({ length: 6 }, () => 'local p = Instance.new("Part")').join('\n');
  assert.deepEqual(rules(lines), ['1:newNoDestroy']);
  assert.deepEqual(rules(lines + '\np:Destroy()'), []);
});

test('drawing objects and tables that only grow are noted', () => {
  const d = Array.from({ length: 3 }, () => 'local d = Drawing.new("Line")').join('\n');
  assert.deepEqual(rules(d), ['1:drawNoRemove']);
  assert.deepEqual(rules(d + '\nd:Remove()'), []);
  const t = Array.from({ length: 5 }, () => 'table.insert(list, x)').join('\n');
  assert.deepEqual(rules(t), ['1:tableOnlyGrows']);
  assert.deepEqual(rules(t + '\ntable.clear(list)'), []);
});

test('a folder is checked, clean files are only counted, and a bad path is an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-audit-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad.lua'), 'while true do\nend');
    fs.writeFileSync(path.join(dir, 'ok.luau'), 'while true do task.wait() end');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'while true do');
    const r = auditPath(dir);
    assert.equal(r.checked, 2);
    assert.equal(r.clean, 1);
    assert.equal(r.warnings, 1);
    assert.equal(r.results[0].file, 'bad.lua');
    assert.throws(() => auditPath(path.join(dir, 'missing')), /does not exist/);
    assert.throws(() => auditPath(''), /Enter/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
