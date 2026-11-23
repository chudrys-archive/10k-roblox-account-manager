'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { encode, FrameDecoder } = require('../src/native-host');

const TOKEN = 'k'.repeat(48);
const HOST = path.join(__dirname, '..', 'src', 'native-host.js');

// Fake manager: answers the native host's status polls and records any cookie it is offered.
function fakeManager(state) {
  const server = http.createServer((req, res) => {
    if (req.headers['x-capture-token'] !== TOKEN) { res.writeHead(401); return res.end(); }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/capture/status') return res.end(JSON.stringify({ armed: state.armed }));
    if (req.method === 'POST' && req.url === '/capture/offer') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        state.offers.push(JSON.parse(b).cookie);
        state.armed = false;
        res.end('{"accepted":true}');
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function startHost(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-host-'));
  fs.writeFileSync(path.join(dir, 'manager.lock'), JSON.stringify({ pid: process.pid, port, token: 'x', captureToken: TOKEN }));
  const child = spawn(process.execPath, [HOST], { env: { ...process.env, IRAM_DATA_DIR: dir }, stdio: ['pipe', 'pipe', 'ignore'] });
  const frames = [];
  const dec = new FrameDecoder();
  child.stdout.on('data', (c) => frames.push(...dec.push(c)));
  return { child, frames };
}

function waitFor(pred, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timed out')); }
    }, 50);
  });
}

test('native host: asks the extension for a cookie only while armed, then hands it to the manager', async () => {
  const state = { armed: true, offers: [] };
  const server = await fakeManager(state);
  const { child, frames } = startHost(server.address().port);
  try {
    await waitFor(() => frames.some((f) => f.type === 'read'));
    const cookie = 'COOKIE-' + 'y'.repeat(30);
    child.stdin.write(encode({ type: 'cookie', value: cookie }));
    await waitFor(() => state.offers.length === 1);
    await waitFor(() => frames.some((f) => f.type === 'close'));
    assert.equal(state.offers[0], cookie);
  } finally {
    child.stdin.end();
    await new Promise((r) => child.on('exit', r));
    server.close();
  }
});

test('native host: sends no read request while the manager is not waiting for a login', async () => {
  const state = { armed: false, offers: [] };
  const server = await fakeManager(state);
  const { child, frames } = startHost(server.address().port);
  try {
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(frames.filter((f) => f.type === 'read').length, 0);
    assert.equal(state.offers.length, 0);
  } finally {
    child.stdin.end();
    await new Promise((r) => child.on('exit', r));
    server.close();
  }
});