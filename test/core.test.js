'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.IRAM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-test-'));

const test = require('node:test');
const assert = require('node:assert');
const { extractCookie, redact, deepMerge, pool } = require('../src/util');
const { resolveTarget, placeLauncherUrl, launchUri } = require('../src/launcher');
const { Vault } = require('../src/vault');

const FAKE = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_' + 'A1B2C3D4'.repeat(40);

test('extractCookie handles common formats', () => {
  assert.equal(extractCookie(FAKE), FAKE);
  assert.equal(extractCookie(`.ROBLOSECURITY=${FAKE}; path=/`), FAKE);
  assert.equal(extractCookie(`user:pass:${FAKE}`), FAKE);
  assert.equal(extractCookie(`{"value":"${FAKE}"}`), FAKE);
  assert.equal(extractCookie('hello'), null);
});

test('redact hides cookies and tickets', () => {
  const s = redact(`cookie ${FAKE} gameinfo:SECRETTICKET+launchtime:1`);
  assert.ok(!s.includes('A1B2C3D4'));
  assert.ok(!s.includes('SECRETTICKET'));
});

test('resolveTarget parses offline formats', async () => {
  assert.deepEqual(await resolveTarget('920587237'), { type: 'game', placeId: 920587237, label: '920587237' });
  const job = await resolveTarget('920587237', { jobId: 'ABCDEF12-1234-1234-1234-1234567890AB' });
  assert.equal(job.type, 'job'); assert.equal(job.jobId, 'abcdef12-1234-1234-1234-1234567890ab');
  const ps = await resolveTarget('https://www.roblox.com/games/123/Some-Game?privateServerLinkCode=987654');
  assert.deepEqual([ps.type, ps.placeId, ps.linkCode], ['private', 123, '987654']);
  const st = await resolveTarget('https://www.roblox.com/games/start?placeId=55&gameInstanceId=11111111-2222-3333-4444-555555555555');
  assert.deepEqual([st.type, st.placeId], ['job', 55]);
  const dl = await resolveTarget('roblox://placeId=77');
  assert.deepEqual([dl.type, dl.placeId], ['game', 77]);
  const prof = await resolveTarget('https://www.roblox.com/users/42/profile');
  assert.deepEqual([prof.type, prof.userId], ['follow', 42]);
  await assert.rejects(resolveTarget('123', { jobId: 'nope' }));
  await assert.rejects(resolveTarget(''));
});

test('placeLauncherUrl + launchUri are well-formed', () => {
  const u = new URL(placeLauncherUrl({ type: 'job', placeId: 1, jobId: 'abc' }, '123'));
  assert.equal(u.searchParams.get('request'), 'RequestGameJob');
  assert.equal(u.searchParams.get('gameId'), 'abc');
  assert.equal(u.searchParams.get('browserTrackerId'), '123');
  const p = new URL(placeLauncherUrl({ type: 'private', placeId: 1, linkCode: 'L' }, '1'));
  assert.equal(p.searchParams.get('linkCode'), 'L');
  const uri = launchUri('TICKET', 'https://x/y?a=1&b=2', '999');
  assert.ok(uri.startsWith('roblox-player:1+launchmode:play+gameinfo:TICKET+'));
  assert.ok(uri.includes('browsertrackerid:999'));
  assert.ok(!uri.includes('&'), 'placelauncherurl must be encoded');
});

test('anti-AFK key mapping', () => {
  const { keyToVk } = require('../src/antiafk');
  assert.equal(keyToVk('a'), 0x41);
  assert.equal(keyToVk('7'), 0x37);
  assert.equal(keyToVk('F1'), 0x70);
  assert.equal(keyToVk('f24'), 0x87);
  assert.equal(keyToVk('F25'), 0);
  assert.equal(keyToVk('ctrl'), 0);
});

test('anti-AFK schedules nudges before the 20-minute kick', async () => {
  const { AntiAfk } = require('../src/antiafk');
  const EventEmitter = require('events');
  const launcher = new EventEmitter();
  const t0 = Date.now();
  launcher.instances = new Map([[1, { pid: 1, accountId: 'a', hwnd: 11, startedAt: t0 - 13 * 60000 }], [2, { pid: 2, accountId: 'b', hwnd: 22, startedAt: t0 - 2 * 60000 }]]);
  launcher.unknown = [];
  let idle = 60000; const nudged = []; // user idle for a minute
  const helper = { call: async (cmd, a) => { if (cmd === 'idle') return idle; if (cmd === 'nudge') { nudged.push(a.hwnds); return a.hwnds.length; } } };
  const cfg = { enabled: true, intervalMin: 12, action: 'space', key: '', waitUserIdleSec: 4, includeUntracked: false };
  const af = new AntiAfk({ helper, launcher, settings: { get: () => cfg }, accounts: { get: () => ({ fields: {} }) } });

  assert.equal(await af.tick(), 1, 'only the client past 12 min is due');
  assert.deepEqual(nudged[0], [11]);
  assert.equal(await af.tick(), 0, 'not due again right away');

  // user typing: defer unless overdue by 3+ min
  launcher.instances.get(2).startedAt = t0 - 13 * 60000;
  idle = 500;
  assert.equal(await af.tick(), 0, 'waits while user is active');
  launcher.instances.get(2).startedAt = t0 - 16 * 60000;
  assert.equal(await af.tick(), 1, 'overdue client is nudged even while user is active');

  assert.equal(await af.tick(true), 2, 'manual nudge hits every client');

  // batching: a client due in <2 min joins the round of one that's due now
  const t1 = Date.now();
  af.last.set(1, t1 - 12 * 60000 - 1000);
  af.last.set(2, t1 - 11 * 60000);
  idle = 60000; nudged.length = 0;
  assert.equal(await af.tick(), 2, 'nearly-due client is batched');
  assert.deepEqual(nudged[0].sort(), [11, 22]);
});

test('deepMerge and pool', async () => {
  assert.deepEqual(deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } }), { a: 1, b: { c: 9, d: 3 } });
  const r = await pool([1, 2, 3, 4], 2, async (x) => { if (x === 3) throw new Error('x'); return x * 2; });
  assert.deepEqual(r.map((x) => x.ok), [true, true, false, true]);
});

test('vault: dpapi-like create, scrypt master password, wrong password rejected', async () => {
  // fake helper: "protect" = base64 passthrough
  const helper = { call: async (cmd, a) => a.data };
  const v = new Vault(helper);
  await v.init();
  v.save({ accounts: [{ id: 'x', cookie: FAKE }] });
  const raw = fs.readFileSync(path.join(process.env.IRAM_DATA_DIR, 'accounts.vault'), 'utf8');
  assert.ok(!raw.includes('A1B2C3D4'), 'vault must not contain plaintext');

  const v2 = new Vault(helper); await v2.init();
  assert.equal(v2.data.accounts[0].cookie, FAKE);

  await v2.setMasterPassword('hunter22');
  const v3 = new Vault(helper); await v3.init();
  assert.ok(v3.locked);
  assert.throws(() => v3.unlock('wrong'));
  v3.unlock('hunter22');
  assert.equal(v3.data.accounts[0].cookie, FAKE);
  assert.ok(v3.verifyPassword('hunter22'));
  assert.ok(!v3.verifyPassword('nope'));

  await v3.setMasterPassword('');
  const v4 = new Vault(helper); await v4.init();
  assert.ok(!v4.locked);
  assert.equal(v4.data.accounts[0].cookie, FAKE);
});
