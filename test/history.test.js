'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { History, MAX_PER_ACCOUNT } = require('../src/history');

test('history keeps the newest entries per account, newest first', () => {
  const h = new History();
  for (let i = 0; i < MAX_PER_ACCOUNT + 20; i++) h.add('a1', 'launch', `#${i}`);
  const list = h.list('a1');
  assert.equal(list.length, MAX_PER_ACCOUNT);
  assert.equal(list[0].msg, `#${MAX_PER_ACCOUNT + 19}`);
  assert.equal(list[list.length - 1].msg, '#20');
  assert.equal(h.list('nobody').length, 0);
});

test('accounts keep separate timelines, and long messages are shortened', () => {
  const h = new History();
  h.add('a1', 'join', 'one');
  h.add('a2', 'join', 'two');
  h.add('a1', 'disconnect', 'z'.repeat(1000));
  assert.deepEqual(h.list('a2').map((e) => e.msg), ['two']);
  assert.equal(h.list('a1')[0].msg.length, 300);
  assert.equal(h.list('a1')[0].kind, 'disconnect');
});

test('entries without an account are ignored', () => {
  const h = new History();
  h.add('', 'guard', 'resumed');
  assert.equal(h.list('').length, 0);
});
