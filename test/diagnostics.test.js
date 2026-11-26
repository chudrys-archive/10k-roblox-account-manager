'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, sanitize, scrubText } = require('../src/diagnostics');

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/abcDEF-token_value';
const COOKIE = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you|_CAEaAhAB.abc123';

const state = {
  settings: { alerts: { webhook: WEBHOOK, events: { crash: true } }, api: { enabled: true, password: 'hunter2', passwordSet: true }, fpsCap: 15, robloxPath: 'C:\\Users\\isach\\AppData\\Local\\Roblox\\x.exe' },
  accounts: [{ username: 'secretname', status: 'valid', keepAlive: { enabled: true } }, { username: 'other', status: 'banned', keepAlive: { enabled: false } }],
  launcher: { instances: [{}, {}], queued: [1], fleet: { totalPrivGB: 3.2, freeGB: 120, limitGB: 191, meanMBPerMin: 14, trend: { label: 'creeping' }, level: 'ok' } },
  preflight: [{ level: 'warn', id: 'x', text: 'Roblox updated' }, { level: 'warn', id: 'k', text: 'Keep-alive is on for 1 account(s) whose cookie is not valid: secretname, other.' }],
  roblox: { path: 'C:\\Users\\isach\\AppData\\Local\\Roblox\\Versions\\v1\\RobloxPlayerBeta.exe' },
  runs: { exits: 2, build: { current: '0.748', previous: '0.747', changed: true } },
};
const logs = [{ t: 1, level: 'info', scope: 'x', msg: `cookie ${COOKIE} and ${WEBHOOK}` }];

test('report contains the useful sections', () => {
  const r = buildReport({ state, logs, now: Date.UTC(2026, 10, 25), versions: { app: '7.1.4', node: 'v24', os: 'Windows' } });
  for (const s of ['## Roblox', '## Findings', '## Fleet right now', '## Accounts', '## Settings', '## Recent activity']) assert.match(r, new RegExp(s));
  assert.match(r, /Clients: 2, queued: 1/);
  assert.match(r, /Total 2 \(1 valid, 1 banned\), keep-alive on: 1/);
  assert.match(r, /changed from 0\.747/);
});

test('no secrets, account names or user names leak', () => {
  const r = buildReport({ state, logs });
  assert.doesNotMatch(r, /discord\.com\/api\/webhooks/);
  assert.doesNotMatch(r, /hunter2/);
  assert.doesNotMatch(r, /CAEaAhAB/);
  assert.doesNotMatch(r, /secretname/);
  assert.doesNotMatch(r, /Users\\isach/);
  assert.match(r, /\[hidden\]/);
  assert.match(r, /\[WEBHOOK\]/);
  assert.match(r, /\[COOKIE\]/);
});

test('boolean flags about secrets are kept, empty secrets stay empty', () => {
  const s = sanitize({ api: { passwordSet: true, password: '' }, webhook: 'https://x' });
  assert.equal(s.api.passwordSet, true);
  assert.equal(s.api.password, '');
  assert.equal(s.webhook, '[hidden]');
});

test('copes with an empty state', () => {
  const r = buildReport({});
  assert.match(r, /None\./);
  assert.match(r, /Total 0/);
  assert.equal(scrubText('C:\\Users\\bob\\x'), 'C:\\Users\\<user>\\x');
});
