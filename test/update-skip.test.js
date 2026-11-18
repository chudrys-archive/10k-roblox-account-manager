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

test('neverUpdate starts the installed client directly, even when outdated', async () => {
  const newestFirst = [dirs[1], dirs[0]];
  resetVersionCache();
  const outdated = await resolveRoblox('', { neverUpdate: true, fetchImpl: fakeFetch({ clientVersionUpload: 'version-ffffffffffffffff' }), dirs: newestFirst });
  assert.equal(outdated.path, 'current.exe');
  assert.equal(outdated.pinned, true);

  resetVersionCache();
  const offline = await resolveRoblox('', { neverUpdate: true, fetchImpl: async () => { throw new Error('offline'); }, dirs: newestFirst });
  assert.equal(offline.path, 'current.exe', 'still launches when the version check fails');

  resetVersionCache();
  const none = await resolveRoblox('', { neverUpdate: true, fetchImpl: fakeFetch({ clientVersionUpload: CURRENT }), dirs: [] });
  assert.ok(!none || !none.pinned, 'nothing installed -> normal launcher so Roblox can be installed');
});

test('a test build takes precedence over the override and normal version selection', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-client-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const testClientPath = path.join(folder, 'RobloxPlayerBeta.exe');
  const override = path.join(folder, 'RobloxPlayerLauncher.exe');
  fs.writeFileSync(testClientPath, '');
  fs.writeFileSync(override, '');
  const fetchImpl = t.mock.fn(async () => { throw new Error('unexpected version check'); });
  const result = await resolveRoblox(override, { testClientPath, dirs, fetchImpl, neverUpdate: true });
  assert.equal(result.path, testClientPath);
  assert.equal(result.testBuild, true);
  assert.equal(fetchImpl.mock.callCount(), 0);

  fs.unlinkSync(testClientPath);
  await assert.rejects(resolveRoblox(override, { testClientPath, dirs, fetchImpl }), /Test Roblox executable/);
  await assert.rejects(resolveRoblox(override, { testClientPath: override, dirs, fetchImpl }), /Test Roblox executable/);
  assert.equal((await resolveRoblox(override, { testClientPath: '', dirs, fetchImpl })).path, override);
  assert.equal(fetchImpl.mock.callCount(), 0);
});

test("Don't update Roblox disables the client's updaters and restores them when turned off", async (t) => {
  const { setUpdatersBlocked, BLOCKED_SUFFIX } = require("../src/launcher");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iram-version-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of ["RobloxPlayerBeta.exe", "RobloxPlayerInstaller.exe"]) fs.writeFileSync(path.join(dir, f), f);
  const installer = path.join(dir, "RobloxPlayerInstaller.exe");

  assert.deepEqual(setUpdatersBlocked(true, [{ dir }]), { changed: 1, failed: [] });
  assert.ok(!fs.existsSync(installer), "installer can no longer be started");
  assert.ok(fs.existsSync(installer + BLOCKED_SUFFIX));
  assert.ok(fs.existsSync(path.join(dir, "RobloxPlayerBeta.exe")), "the game client is untouched");
  assert.equal(setUpdatersBlocked(true, [{ dir }]).changed, 0, "blocking twice is a no-op");

  assert.equal(setUpdatersBlocked(false, [{ dir }]).changed, 1);
  assert.equal(fs.readFileSync(installer, "utf8"), "RobloxPlayerInstaller.exe", "restored intact");
  assert.ok(!fs.existsSync(installer + BLOCKED_SUFFIX));
});

test("Don't update Roblox keeps starting the build Roblox registered, not the newest file", async () => {
  const newestFirst = [dirs[1], dirs[0]];
  const kept = path.join(dirs[0].dir, "RobloxPlayerBeta.exe");
  resetVersionCache();
  const r = await resolveRoblox("", { neverUpdate: true, registered: kept, fetchImpl: fakeFetch({ clientVersionUpload: CURRENT }), dirs: newestFirst });
  assert.equal(r.path, "old.exe", "the registered (kept) build wins over a newer-looking folder");
  resetVersionCache();
  const none = await resolveRoblox("", { neverUpdate: true, registered: null, fetchImpl: fakeFetch({ clientVersionUpload: CURRENT }), dirs: newestFirst });
  assert.equal(none.path, "current.exe", "falls back to the newest folder when nothing is registered");
});
