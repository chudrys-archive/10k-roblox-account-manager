'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inQuietHours, Alerts } = require('../src/alerts');

const at = (h, m) => new Date(2026, 10, 25, h, m);

test('quiet hours: off, same-day window, window across midnight, bad input', () => {
  assert.equal(inQuietHours({ enabled: false, start: '23:00', end: '07:00' }, at(2, 0)), false);
  assert.equal(inQuietHours({ enabled: true, start: '09:00', end: '17:00' }, at(12, 0)), true);
  assert.equal(inQuietHours({ enabled: true, start: '09:00', end: '17:00' }, at(17, 0)), false);
  assert.equal(inQuietHours({ enabled: true, start: '23:00', end: '07:00' }, at(23, 30)), true);
  assert.equal(inQuietHours({ enabled: true, start: '23:00', end: '07:00' }, at(6, 59)), true);
  assert.equal(inQuietHours({ enabled: true, start: '23:00', end: '07:00' }, at(7, 0)), false);
  assert.equal(inQuietHours({ enabled: true, start: '25:00', end: '07:00' }, at(1, 0)), false);
  assert.equal(inQuietHours({ enabled: true, start: '08:00', end: '08:00' }, at(8, 0)), false);
  assert.equal(inQuietHours(undefined, at(1, 0)), false);
});

test('Alerts.send holds back non-errors in quiet hours but not errors', () => {
  const quiet = { enabled: true, start: '00:00', end: '23:59' };
  const a = new Alerts({ settings: { get: () => ({ webhook: 'https://discord.com/api/webhooks/1/x', events: { crash: true }, cooldownMin: 0, quiet }) } });
  a.pump = () => {};
  const now = new Date();
  const inside = inQuietHours(quiet, now);
  a.send('crash', 't', 'd', { level: 'warn', key: 'a' });
  a.send('crash', 't', 'd', { level: 'error', key: 'b' });
  assert.equal(a.queue.length, inside ? 1 : 2);
});
