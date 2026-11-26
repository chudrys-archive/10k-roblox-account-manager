const test = require('node:test');
const assert = require('node:assert');
const { LogWatcher } = require('../src/logwatch');

const JOIN = "2026-11-26T03:51:47.000Z,1.0,1,6,Info [FLog::Output] ! Joining game 'ca7de910-0000-0000-0000-000000000000' place 13379208636 at 1.2.3.4";
const TP_FAIL = '2026-11-26T13:55:12.277Z,1.0,1,6,Error [FLog::CreatorError] Error: raiseTeleportInitFailedEvent: Teleport failed because Not authorized to join this experience (Unauthorized)';

function run(lines) {
  const events = [];
  const ctx = { emit: (name) => events.push(name), launcher: { emit() {} } };
  const inst = {};
  for (const l of lines) LogWatcher.prototype.parse.call(ctx, inst, l);
  return { s: inst.logState, events };
}

test('text-only "kicked from the game" disconnect marks the client as not in game', () => {
  const { s, events } = run([JOIN, '2026-11-26T06:38:46.708Z,1.0,1,7 [FLog::Network] Client has been disconnected with reason: You have been kicked from the game']);
  assert.strictEqual(s.inGame, false);
  assert.strictEqual(s.reason, 'kicked from the game');
  assert.ok(events.includes('disconnect'));
});

test('"joined from another device" is reported as the same account launched elsewhere', () => {
  const { s } = run([JOIN, '2026-11-26T06:38:34.591Z,1.0,1,7 [FLog::Network] Client has been disconnected with reason: Disconnected from game, possibly due to game joined from another device']);
  assert.strictEqual(s.inGame, false);
  assert.strictEqual(s.reason, 'same account launched elsewhere');
});

test('ten rejected teleports in a row flag a rejoin loop, nine do not, a new join resets it', () => {
  assert.strictEqual(run([JOIN, ...Array(9).fill(TP_FAIL)]).s.rejoinLoop, false);
  const ten = run([JOIN, ...Array(10).fill(TP_FAIL)]);
  assert.strictEqual(ten.s.rejoinLoop, true);
  assert.strictEqual(ten.s.inGame, false);
  assert.strictEqual(run([JOIN, ...Array(10).fill(TP_FAIL), JOIN]).s.rejoinLoop, false);
});
