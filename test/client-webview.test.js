'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-webview-'));
const { clientWebviewDir } = require('../src/launcher');

test('every account gets its own browser profile folder under the data dir', () => {
  const a = clientWebviewDir('D:\\data', '5ef13309-ee9c-45f8-8e83-5ccd0341f4e6');
  const b = clientWebviewDir('D:\\data', '9b17ca31-d9b2-491d-b466-b62ca86215d9');
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith(path.join('D:\\data', 'client-webview')));
  assert.ok(a.endsWith('5ef13309-ee9c-45f8-8e83-5ccd0341f4e6'));
});

test('an account id can never walk out of the profile folder', () => {
  const d = clientWebviewDir('D:\\data', '..\\..\\Windows\\x');
  assert.strictEqual(path.dirname(d), path.join('D:\\data', 'client-webview'));
  assert.strictEqual(clientWebviewDir('D:\\data', ''), null);
  assert.strictEqual(clientWebviewDir('D:\\data', '...'), null);
});