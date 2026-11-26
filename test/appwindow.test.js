'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const appWindow = require('../src/appwindow');

test('the window host gets the page address and the data folder as separate arguments', () => {
  const args = appWindow.hostArgs('http://127.0.0.1:7963/?t=abc', 'C:\\data dir');
  assert.deepEqual(args, ['--url', 'http://127.0.0.1:7963/?t=abc', '--data', 'C:\\data dir']);
});

test('host state is one of the known values and the exe lives under bin/window', () => {
  assert.ok(['ready', 'stale', 'missing', 'unsupported'].includes(appWindow.hostState()));
  assert.equal(path.basename(appWindow.EXE), '10k-window.exe');
  assert.equal(path.basename(path.dirname(appWindow.EXE)), 'window');
});
