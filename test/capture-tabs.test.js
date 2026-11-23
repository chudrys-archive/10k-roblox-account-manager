'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CaptureGate } = require('../src/capture');

test('a login window that was seen and then closed cancels the wait', async () => {
  const g = new CaptureGate();
  const p = g.arm({ timeoutMs: 60000, label: 'test' });
  g.noteTabs(0); // window not open yet: keep waiting
  assert.ok(g.armed());
  g.noteTabs(1); // window seen
  g.noteTabs(0); g.noteTabs(0);
  assert.ok(g.armed(), 'two empty reads are not enough');
  g.noteTabs(0);
  await assert.rejects(p, (e) => e.windowClosed === true);
  assert.ok(!g.armed());
});

test('quick login exposes its QR image only while it waits', () => {
  const g = new CaptureGate();
  const p = g.arm({ timeoutMs: 60000, label: 'quick', qr: true });
  p.catch(() => {});
  assert.deepStrictEqual(g.qrState(), { armed: true, src: null });
  assert.ok(!g.setQr('javascript:alert(1)'), 'only image data URLs are accepted');
  assert.ok(g.setQr('data:image/png;base64,AAAA'));
  assert.strictEqual(g.qrState().src, 'data:image/png;base64,AAAA');
  assert.strictEqual(g.status().qr, true);
  g.cancel('test');
  assert.deepStrictEqual(g.qrState(), { armed: false, src: null });
});

test('an open login window keeps the wait going', () => {
  const g = new CaptureGate();
  const p = g.arm({ timeoutMs: 60000, label: 'test' });
  p.catch(() => {});
  for (let i = 0; i < 10; i++) g.noteTabs(1);
  assert.ok(g.armed());
  g.cancel('test');
});