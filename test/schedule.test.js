'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDays, normalize, isActive } = require('../src/schedule');

// 2026-11-23 is a Monday
const at = (day, h, m = 0) => new Date(2026, 10, 22 + day, h, m); // day 0 = Sunday 22nd

test('parseDays reads digits, treats 7 as Sunday, ignores junk', () => {
  assert.deepEqual(parseDays('12345'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays('7,1'), [0, 1]);
  assert.deepEqual(parseDays([6, 0]), [0, 6]);
  assert.deepEqual(parseDays('abc'), []);
});

test('normalize fills a safe full-week default and fixes bad times to a full day', () => {
  const n = normalize({ enabled: true, start: '99:99', end: 'x', days: '' });
  assert.deepEqual(n, { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6], closeAtEnd: false });
});

test('disabled schedule is always active', () => {
  assert.equal(isActive({ enabled: false, start: '09:00', end: '10:00' }, at(1, 3)), true);
});

test('same-day window on selected weekdays', () => {
  const cfg = { enabled: true, start: '09:00', end: '17:00', days: '12345' };
  assert.equal(isActive(cfg, at(1, 12)), true);
  assert.equal(isActive(cfg, at(1, 17)), false);
  assert.equal(isActive(cfg, at(0, 12)), false); // Sunday
  assert.equal(isActive(cfg, at(6, 12)), false); // Saturday
});

test('window across midnight belongs to the day it started on', () => {
  const cfg = { enabled: true, start: '22:00', end: '02:00', days: '5' }; // Friday night
  assert.equal(isActive(cfg, at(5, 23)), true);
  assert.equal(isActive(cfg, at(6, 1)), true);   // Saturday 01:00 is still Friday's window
  assert.equal(isActive(cfg, at(6, 23)), false); // Saturday night is not
  assert.equal(isActive(cfg, at(5, 1)), false);  // Friday 01:00 belongs to Thursday's window
});

test('start equal to end means all day on the chosen days', () => {
  assert.equal(isActive({ enabled: true, start: '08:00', end: '08:00', days: '1' }, at(1, 3)), true);
  assert.equal(isActive({ enabled: true, start: '08:00', end: '08:00', days: '1' }, at(2, 3)), false);
});
