'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-test-'));

const test = require('node:test');
const assert = require('node:assert');
const { pickUpToDate, currentRobloxVersion, resolveRoblox, resetVersionCache } = require('../src/launcher');

const CURRENT = 'version-1a2b3c4d5e6f7a8b';
const fakeFetch = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 503, json: async () => body });
const dirs = [
  { dir: path.join('C:', 'Roblox', 'Versions', 'version-0000000000000000'), exe: 'old.exe' },
  { dir: path.join('C:', 'Roblox', 'Versions', CURRENT), exe: 'current.exe' },
];

test('pickUpToDate finds the folder named after the current version', () => {
  assert.equal(pickUpToDate(CURRENT, dirs).exe, 'current.exe');
  assert.equal(pickUpToDate(CURRENT.toUpperCase(), dirs).exe, 'current.exe');
  assert.equal(pickUpToDate('version-ffffffffffffffff', dirs), null);
  assert.equal(pickUpToDate(null, dirs), null);
});

test('currentRobloxVersion reads clientVersionUpload and caches it', async () => {
  resetVersionCache();
  let calls = 0;
  const f = async () => { calls++; return { ok: true, json: async () => ({ clientVersionUpload: CURRENT }) }; };
  assert.equal(await currentRobloxVersion({ fetchImpl: f, now: 1000 }), CURRENT);
  assert.equal(await currentRobloxVersion({ fetchImpl: f, now: 2000 }), CURRENT);
  assert.equal(calls, 1, 'second call within 5 min uses the cache');
  await currentRobloxVersion({ fetchImpl: f, now: 1000 + 6 * 60 * 1000 });
  assert.equal(calls, 2, 'cache expires');
});

test('currentRobloxVersion rejects bad answers', async () => {
  resetVersionCache();
  await assert.rejects(currentRobloxVersion({ fetchImpl: fakeFetch({}, false) }), /HTTP 503/);
  await assert.rejects(currentRobloxVersion({ fetchImpl: fakeFetch({ clientVersionUpload: '<html>' }) }), /unexpected/);
});

test('resolveRoblox launches directly only when the installed client is current', async () => {
  resetVersionCache();
  const hit = await resolveRoblox('', { fetchImpl: fakeFetch({ clientVersionUpload: CURRENT }), dirs });
  assert.equal(hit.path, 'current.exe');
  assert.equal(hit.direct, true);

  resetVersionCache();
  const miss = await resolveRoblox('', { fetchImpl: fakeFetch({ clientVersionUpload: 'version-ffffffffffffffff' }), dirs });
  assert.ok(!miss || !miss.direct, 'outdated -> normal launcher path');

  resetVersionCache();
  const offline = await resolveRoblox('', { fetchImpl: async () => { throw new Error('offline'); }, dirs });
  assert.ok(!offline || !offline.direct, 'network error -> normal launcher path');

  resetVersionCache();
  const off = await resolveRoblox('', { skipUpdateCheck: false, fetchImpl: fakeFetch({ clientVersionUpload: CURRENT }), dirs });
  assert.ok(!off || !off.direct, 'setting off -> normal launcher path');
});
