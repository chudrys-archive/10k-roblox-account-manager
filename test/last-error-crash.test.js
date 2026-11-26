'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { History } = require('../src/history');
const { RunLog } = require('../src/runlog');

test('History.lastOf returns the newest entry of the wanted kinds only', () => {
  const h = new History();
  h.add('a', 'launch', 'started');
  h.add('a', 'disconnect', 'code 277');
  h.add('a', 'join', 'joined');
  assert.strictEqual(h.lastOf('a', ['disconnect', 'verify']).msg, 'code 277');
  assert.strictEqual(h.lastOf('a', ['verify']), null);
  assert.strictEqual(h.lastOf('nobody', ['disconnect']), null);
});

test('RunLog.stats24h reports the newest unplanned exit and ignores closes the manager asked for', () => {
  const now = Date.now();
  const mk = (accountId, endedAt, kind, reason) => ({ accountId, username: accountId, startedAt: endedAt - 600000, endedAt, uptimeMs: 600000, kind, reason, short: false });
  const rl = new RunLog({});
  for (const r of [mk('x', now - 3000, 'closed', 'closed by manager'), mk('y', now - 2000, 'disconnected', 'code 277'), mk('z', now - 1000, 'exited', 'client exited without being asked to'), mk('old', now - 30 * 3600e3, 'exited', 'too old')]) rl.add(r);
  const s = rl.stats24h(now);
  assert.strictEqual(s.exits, 2);
  assert.strictEqual(s.last.accountId, 'z');
  const rl2 = new RunLog({});
  rl2.add(mk('x', now - 3000, 'closed', 'closed by manager'));
  assert.strictEqual(rl2.stats24h(now).last, null);
});

test('exitKind: exit code 0 is closed by hand, other codes and unreadable codes stay unplanned', () => {
  const { exitKind } = require('../src/runlog');
  assert.deepStrictEqual(exitKind({ exitCode: 0 }), { kind: 'closed', reason: 'closed by hand' });
  assert.strictEqual(exitKind({ exitCode: 1 }).kind, 'exited');
  assert.match(exitKind({ exitCode: 3221225477 }).reason, /0xC0000005/);
  assert.deepStrictEqual(exitKind({}), { kind: 'exited', reason: 'client exited without being asked to' });
  assert.deepStrictEqual(exitKind({ exitCode: null }), { kind: 'exited', reason: 'client exited without being asked to' });
  assert.strictEqual(exitKind({ exitCode: 0, killReason: 'closed by manager' }).reason, 'closed by manager');
  assert.strictEqual(exitKind({ exitCode: 0, log: { disconnectedAt: 5, reason: 'kicked' } }).kind, 'disconnected');
});

test('recordDisconnect: real reasons at once, teleport code only if the client stays out of game', () => {
  const { History, recordDisconnect, TELEPORT_CODE } = require('../src/history');
  const timers = [];
  const opts = { settleMs: 15000, setTimer: (fn, ms) => { timers.push({ fn, ms }); return {}; } };
  const h = new History();
  // kicked: immediate
  const kicked = { disconnectedAt: 100, reportedAt: 0, code: 267, reason: 'kicked', inGame: false };
  assert.equal(recordDisconnect(h, 'a', kicked, opts), true);
  assert.equal(h.list('a').length, 1);
  assert.equal(recordDisconnect(h, 'a', kicked, opts), false, 'same disconnect is not recorded twice');
  // teleport: deferred, then dropped when the client joined again
  const tp = { disconnectedAt: 200, reportedAt: 0, code: TELEPORT_CODE, reason: 'left the game', inGame: false };
  recordDisconnect(h, 'b', tp, opts);
  assert.equal(h.list('b').length, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 15000);
  tp.inGame = true; tp.disconnectedAt = 0;
  timers[0].fn();
  assert.equal(h.list('b').length, 0, 'rejoined: nothing recorded');
  // teleport that never comes back: recorded after the wait
  const lost = { disconnectedAt: 300, reportedAt: 0, code: TELEPORT_CODE, reason: 'left the game', inGame: false };
  recordDisconnect(h, 'c', lost, opts);
  timers[1].fn();
  assert.equal(h.list('c').length, 1);
  assert.match(h.list('c')[0].msg, /left the game \(code 285\)/);
  // a newer disconnect replaces the stamp: the old timer must not report it
  const twice = { disconnectedAt: 400, reportedAt: 0, code: TELEPORT_CODE, reason: 'left the game', inGame: false };
  recordDisconnect(h, 'd', twice, opts);
  twice.disconnectedAt = 500;
  timers[2].fn();
  assert.equal(h.list('d').length, 0);
  assert.equal(recordDisconnect(h, 'x', null, opts), false);
});
