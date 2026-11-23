#!/usr/bin/env node
'use strict';
// Chrome native messaging host for the capture extension. Chrome starts this process and talks to it over
// stdin/stdout. It relays between the extension and the manager's local server. It never writes a cookie to
// disk and never logs one. It asks the extension for a cookie only while the manager is waiting for a login.
const fs = require('fs');
const path = require('path');
const http = require('http');

const POLL_MS = 1500;
const READ_GAP_MS = 2000;

function encode(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Incremental decoder for Chrome's 4-byte little-endian length-prefixed JSON frames. */
class FrameDecoder {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > 1024 * 1024) throw new Error('frame too large');
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len).toString('utf8');
      this.buf = this.buf.subarray(4 + len);
      try { out.push(JSON.parse(body)); } catch { /* ignore a malformed frame */ }
    }
    return out;
  }
}

function readLock(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dataDir, 'manager.lock'), 'utf8'));
    if (lock && lock.port && lock.captureToken) return lock;
  } catch { /* manager not running */ }
  return null;
}

function request(lock, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'x-capture-token': lock.captureToken };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port: lock.port, path: p, method, headers, timeout: 4000 }, (res) => {
      let txt = '';
      res.on('data', (d) => { txt += d; });
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(txt ? JSON.parse(txt) : {}); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function main() {
  const dataDir = process.env.IRAM_DATA_DIR || '';
  let readPending = false;
  let lastReadAt = 0;
  let openedFor = null; // quick login: the login window is asked for once per login
  const send = (obj) => process.stdout.write(encode(obj));
  const decoder = new FrameDecoder();

  process.stdin.on('data', async (chunk) => {
    let msgs;
    try { msgs = decoder.push(chunk); } catch { process.exit(1); return; }
    for (const m of msgs) {
      if (m && m.type === 'qr') {
        // the QR code of a quick login, passed on to the manager to show. It is not stored on disk.
        const lock = readLock(dataDir);
        if (lock && typeof m.src === 'string') request(lock, 'POST', '/capture/qr', { src: m.src }).catch(() => {});
        continue;
      }
      if (m && m.type === 'closed') {
        // the person closed the login window by hand before a cookie was captured: stop waiting for it
        const lock = readLock(dataDir);
        if (lock) request(lock, 'POST', '/capture/closed', {}).catch(() => {});
        continue;
      }
      if (!m || m.type !== 'cookie') continue;
      readPending = false;
      const lock = readLock(dataDir);
      if (!lock) continue;
      const value = typeof m.value === 'string' && m.value ? m.value : null;
      try {
        const tabs = typeof m.tabs === 'number' ? m.tabs : null;
        const r = await request(lock, 'POST', '/capture/offer', { cookie: value, tabs });
        if (r && r.accepted) send({ type: 'close' });
      } catch { /* manager gone */ }
    }
  });
  process.stdin.on('end', () => process.exit(0));

  setInterval(async () => {
    const lock = readLock(dataDir);
    if (!lock) { readPending = false; return; }
    let st;
    try { st = await request(lock, 'GET', '/capture/status'); } catch { return; }
    if (!st || !st.armed) { readPending = false; openedFor = null; return; }
    if (st.qr && st.until !== openedFor) {
      openedFor = st.until;
      send({ type: 'open', url: 'https://www.roblox.com/login' });
    }
    if (readPending && Date.now() - lastReadAt < READ_GAP_MS) return;
    readPending = true;
    lastReadAt = Date.now();
    send({ type: 'read', qr: !!st.qr });
  }, POLL_MS);
}

if (require.main === module) main();

module.exports = { encode, FrameDecoder };