'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-burst-'));

const test = require('node:test');
const assert = require('node:assert');
const { exitBurst } = require('../src/watchdog');

test('a single exit gets no extra delay', () => {
  const r = exitBurst([], 1000, () => 0.99);
  assert.equal(r.extraMs, 0);
  assert.equal(r.times.length, 1);
});

test('the third exit inside a minute is a burst and its relaunch is spread out', () => {
  let r = exitBurst([], 1000, () => 0.99);
  r = exitBurst(r.times, 2000, () => 0.99);
  assert.equal(r.extraMs, 0);
  r = exitBurst(r.times, 3000, () => 0.5);
  assert.equal(r.extraMs, 45000);
});

test('exits more than a minute apart do not form a burst', () => {
  let r = exitBurst([], 0, () => 0.99);
  r = exitBurst(r.times, 30e3, () => 0.99);
  r = exitBurst(r.times, 61e3, () => 0.99);
  assert.equal(r.times.length, 2);
  assert.equal(r.extraMs, 0);
});
