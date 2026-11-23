'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-update-'));
process.env.IRAM_DATA_DIR = scratch;
const { UpdateChecker, isNewer, LATEST_URL } = require('../src/updatecheck');

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const f = async (url) => { f.lastUrl = url; return { ok, status, json: async () => body }; };
  return f;
}

test('isNewer compares x.y.z numerically', () => {
  assert.equal(isNewer('v7.0.9', '7.0.8'), true);
  assert.equal(isNewer('7.0.8', '7.0.8'), false);
  assert.equal(isNewer('7.0.7', '7.0.8'), false);
  assert.equal(isNewer('7.10.0', '7.9.9'), true);
  assert.equal(isNewer('8.0.0', '7.99.99'), true);
  assert.equal(isNewer('nonsense', '7.0.8'), false);
  assert.equal(isNewer('7.0.9', null), false);
});

test('check reports a newer published release', async () => {
  const u = new UpdateChecker({ fetchImpl: fakeFetch({ tag_name: 'v7.0.9', html_url: 'https://example.test/r' }), current: '7.0.8' });
  const info = await u.check();
  assert.equal(info.available, true);
  assert.equal(info.latest, '7.0.9');
  assert.equal(info.url, 'https://example.test/r');
  assert.equal(info.error, null);
  assert.equal(u.publicView().current, '7.0.8');
});

test('check stays quiet when the release is the same or older', async () => {
  const u = new UpdateChecker({ fetchImpl: fakeFetch({ tag_name: 'v7.0.8', html_url: 'x' }), current: '7.0.8' });
  assert.equal((await u.check()).available, false);
});

test('check asks the GitHub latest-release endpoint', async () => {
  const f = fakeFetch({ tag_name: 'v7.0.8', html_url: 'x' });
  await new UpdateChecker({ fetchImpl: f, current: '7.0.8' }).check();
  assert.equal(f.lastUrl, LATEST_URL);
});

test('a failed check keeps the last answer and records the error', async () => {
  const u = new UpdateChecker({ fetchImpl: fakeFetch({ message: 'rate limited' }, { ok: false, status: 403 }), current: '7.0.8' });
  const info = await u.check();
  assert.equal(info.available, false);
  assert.match(info.error, /HTTP 403/);
});

test('an unreadable release name is an error, not an update', async () => {
  const u = new UpdateChecker({ fetchImpl: fakeFetch({ tag_name: 'latest' }), current: '7.0.8' });
  const info = await u.check();
  assert.equal(info.available, false);
  assert.ok(info.error);
});