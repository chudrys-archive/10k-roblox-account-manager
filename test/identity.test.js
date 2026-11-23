'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-id-'));

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const { Launcher } = require('../src/launcher');
const { Watchdog } = require('../src/watchdog');
const { LogWatcher } = require('../src/logwatch');
const { DEFAULTS } = require('../src/settings');

function setup(n = 3, { killRemoves = false } = {}) {
  const settings = new EventEmitter();
  const cfg = { ...DEFAULTS, multiInstance: false, renameWindows: false };
  settings.get = (k) => (k ? cfg[k] : cfg);
  const list = Array.from({ length: n }, (_, i) => ({ id: `acc${i}`, userId: 1000 + i, username: `alt${i}`, alias: '', group: 'Default', status: 'valid', fields: {}, keepAlive: { enabled: true, target: { type: 'game', placeId: 1 } } }));
  const accounts = new EventEmitter();
  Object.assign(accounts, { list, loaded: true, get: (id) => list.find((a) => a.id === id) || null, displayName: (a) => a.username, save() {}, session: () => ({}) });
  let procs = [];
  const killed = [];
  const helper = {
    procs: async () => procs,
    call: async (cmd, a) => {
      if (cmd === 'kill') {
        killed.push(...a.pids);
        if (killRemoves) procs = procs.filter((p) => !a.pids.includes(p.pid)); // the process really exits
        return a.pids.length;
      }
      return 0;
    },
  };
  const launcher = new Launcher({ helper, settings, accounts });
  return { launcher, accounts, list, setProcs: (p) => { procs = p; }, killed, settings };
}
const P = (pid, btid, startOffsetMs = 0) => ({ pid, btid, hwnd: pid * 10, title: '', memMB: 100, hung: false, start: new Date(Date.now() + startOffsetMs).toISOString() });

test('30 clients: every process maps to exactly the account whose launch tag it carries', async () => {
  const { launcher, setProcs } = setup(30);
  const procs = [];
  for (let i = 0; i < 30; i++) {
    const tag = `17949${String(i).padStart(11, '0')}`;
    launcher.btids.set(tag, { accountId: `acc${i}`, at: Date.now() });
    procs.push(P(5000 + i, tag));
  }
  // shuffle so order can't accidentally line up
  procs.sort(() => Math.random() - 0.5);
  setProcs(procs);
  await launcher.sync();
  assert.equal(launcher.instances.size, 30);
  for (const inst of launcher.instances.values()) {
    const i = Number(inst.accountId.slice(3));
    assert.equal(inst.btid, `17949${String(i).padStart(11, '0')}`);
    assert.equal(inst.pid, 5000 + i);
  }
  const perAccount = new Map();
  for (const inst of launcher.instances.values()) perAccount.set(inst.accountId, (perAccount.get(inst.accountId) || 0) + 1);
  assert.ok([...perAccount.values()].every((c) => c === 1), 'no account has two instances');
});

test('starter + real client sharing one tag become ONE instance, and the hand-off is silent', async () => {
  const { launcher, setProcs } = setup(1);
  launcher.btids.set('T1', { accountId: 'acc0', at: Date.now() });
  const exits = [];
  launcher.on('exit', (i) => exits.push(i.pid));
  setProcs([P(10, 'T1', -2000), P(11, 'T1', 0)]); // starter (older) and real client (newer)
  await launcher.sync();
  assert.equal(launcher.instances.size, 1);
  assert.ok(launcher.instances.has(11), 'newest process (real client) is the instance');
  setProcs([P(11, 'T1', 0)]); // starter exits
  await launcher.sync();
  assert.equal(launcher.instances.size, 1);
  assert.deepEqual(exits, []);
  // if the tracked one were the starter, its exit hands over to the heir
  launcher.instances.clear();
  launcher.instances.set(10, { pid: 10, accountId: 'acc0', btid: 'T1', startedAt: Date.now() - 60000 });
  await launcher.sync();
  assert.ok(launcher.instances.has(11) && !launcher.instances.has(10));
  assert.deepEqual(exits, []);
});

test('a killed process is never re-adopted while it is shutting down', async () => {
  const { launcher, setProcs, killed } = setup(1, { killRemoves: true });
  launcher.btids.set('T1', { accountId: 'acc0', at: Date.now() });
  const dying = P(20, 'T1'); // same process object (same start time) throughout: pid reuse would differ
  setProcs([dying]);
  await launcher.sync();
  assert.ok(launcher.instances.has(20));
  await launcher.kill([20], 'test');
  assert.deepEqual(killed, [20]);
  assert.equal(launcher.instances.size, 0);
  // the dying process is still listed for a moment after the kill
  setProcs([dying]);
  await launcher.sync();
  assert.equal(launcher.instances.size, 0, 'dying pid must not be adopted again');
});

test('a kill that leaves the process alive keeps the instance (failed kill never hides a live client)', async () => {
  const { launcher, setProcs } = setup(1);
  launcher.btids.set('T1', { accountId: 'acc0', at: Date.now() });
  setProcs([P(20, 'T1')]);
  await launcher.sync();
  await launcher.kill([20], 'test');
  assert.ok(launcher.instances.has(20), 'live client must stay tracked');
});

test('a process with an unknown tag is never assigned to any account', async () => {
  const { launcher, setProcs } = setup(2);
  launcher.btids.set('T1', { accountId: 'acc0', at: Date.now() });
  setProcs([P(30, 'SOMETHING-ELSE'), P(31, null)]);
  await launcher.sync();
  assert.equal(launcher.instances.size, 0);
  assert.equal(launcher.unknown.length, 2, 'shown as untracked instead');
});

test('identity check: a client signed in as another account is closed and keep-alive paused', async () => {
  const { launcher, accounts, list, killed } = setup(2);
  const settings = { get: (k) => (k ? DEFAULTS[k] : DEFAULTS) };
  const logwatch = new LogWatcher({ launcher, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nolog-')) });
  const sent = [];
  const wd = new Watchdog({ launcher, accounts, settings, logwatch, alerts: { send: (...a) => sent.push(a) } });
  wd.start(); wd.stop();
  const good = { pid: 40, accountId: 'acc0', btid: 'A', startedAt: Date.now() };
  const bad = { pid: 41, accountId: 'acc1', btid: 'B', startedAt: Date.now() };
  launcher.instances.set(40, good); launcher.instances.set(41, bad);
  logwatch.parse(good, `x [FLog::AvatarJoinMetrics]   userId = ${list[0].userId}`);
  logwatch.parse(bad, `x [FLog::AvatarJoinMetrics]   userId = ${list[0].userId}`); // acc1's client is really acc0!
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(good.verified, true);
  assert.equal(bad.verified, false);
  assert.deepEqual(killed, [41]);
  assert.equal(list[1].keepAlive.enabled, false);
  assert.equal(list[0].keepAlive.enabled, true, 'the correct account is untouched');
  assert.match(sent[0][2], /alt1.*alt0/s);
});
