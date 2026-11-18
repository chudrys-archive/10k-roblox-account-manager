'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-quit-'));

const test = require('node:test');
const assert = require('node:assert');
const { Launcher } = require('../src/launcher');
const { WinHelper } = require('../src/winhelper');

const STOP_FILE = path.join(process.env.IRAM_DATA_DIR, 'lockholder.stop');

/** A launcher with a fake helper and a fake lock holder that exits when asked to stop. */
function setup({ clients = [] } = {}) {
  const procs = [...clients];
  const killed = [];
  const helper = {
    procs: async () => procs.map((pid) => ({ pid })),
    call: async (cmd, args) => {
      if (cmd !== 'kill') throw new Error('unexpected ' + cmd);
      for (const pid of args.pids) { killed.push(pid); procs.splice(procs.indexOf(pid), 1); }
      return args.pids.length;
    },
  };
  const l = new Launcher({ helper, settings: { get: () => false, on() {} }, accounts: { get: () => null } });
  l.persist = () => {};
  l.unknown = clients.map((pid) => ({ pid }));
  let holder = { pid: 4242 };
  l.lockStatus = () => {
    if (holder && fs.existsSync(STOP_FILE)) { holder = null; fs.rmSync(STOP_FILE, { force: true }); }
    return holder;
  };
  return { l, killed, holderRunning: () => !!holder };
}

test('quit stops the lock holder when no Roblox client is running', async () => {
  const { l, holderRunning } = setup();
  const r = await l.stopBackground();
  assert.deepEqual(r, { clientsLeft: 0, lockHolder: 'stopped' });
  assert.equal(holderRunning(), false);
});

test('quit keeps the lock holder while Roblox clients keep running', async () => {
  const { l, killed, holderRunning } = setup({ clients: [11, 12] });
  const r = await l.stopBackground();
  assert.deepEqual(r, { clientsLeft: 2, lockHolder: 'kept' });
  assert.equal(holderRunning(), true, 'clients would close each other without it');
  assert.deepEqual(killed, []);
});

test('"also close Roblox clients" closes them and then stops the lock holder', async () => {
  const { l, killed, holderRunning } = setup({ clients: [11, 12] });
  const r = await l.stopBackground({ closeClients: true });
  assert.deepEqual(killed.sort(), [11, 12]);
  assert.deepEqual(r, { clientsLeft: 0, lockHolder: 'stopped' });
  assert.equal(holderRunning(), false);
});

test('WinHelper.stop waits for the helper process to exit', { skip: process.platform !== 'win32' }, async () => {
  const h = new WinHelper();
  await h.start();
  const pid = h.proc.pid;
  await h.stop();
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'helper process is gone');
});
