'use strict';
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('launches a pinned older client accepted by a fake service', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-older-client-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  process.env.IRAM_DATA_DIR = scratch;

  const olderBuild = 'version-0000000000000001';
  const currentBuild = 'version-0000000000000002';
  const acceptedBuilds = new Set([currentBuild]);
  assert.equal(acceptedBuilds.has(olderBuild), false);
  acceptedBuilds.add(olderBuild); // This policy belongs to the fake service.

  const buildDir = path.join(scratch, olderBuild);
  fs.mkdirSync(buildDir);
  const testClientPath = path.join(buildDir, 'RobloxPlayerBeta.exe');
  fs.writeFileSync(testClientPath, '');

  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  const { api } = require('../src/roblox');
  t.mock.method(api, 'getAuthTicket', async () => 'fake-ticket');
  const processes = [];
  const spawn = t.mock.method(childProcess, 'spawn', (executable, [uri], options) => {
    assert.equal(executable, testClientPath);
    assert.equal(options.cwd, buildDir);
    const build = path.basename(path.dirname(executable));
    assert.ok(acceptedBuilds.has(build), 'the fake service accepts the selected build');

    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => {
      const [, btid] = uri.match(/\+browsertrackerid:(\d+)/);
      processes.push({ pid: 1234, btid });
      child.emit('spawn');
    });
    return child;
  });

  // Load after replacing spawn so the fixture never runs as a Windows program.
  const { Launcher } = require('../src/launcher');
  const config = { testClientPath, launchDelaySec: 0, launchTimeoutSec: 5 };
  const account = { id: 'test-account', username: 'TestAccount' };
  const launcher = new Launcher({
    settings: { get: (key) => config[key] },
    accounts: { get: () => account, session: () => ({}), save() {} },
    helper: { procs: async () => [...processes] },
  });
  const result = await launcher.launch(account.id, { type: 'game', placeId: 1 });

  assert.equal(result.pid, 1234);
  assert.equal(launcher.byAccount(account.id)[0].pid, 1234);
  assert.equal(spawn.mock.callCount(), 1);
});
