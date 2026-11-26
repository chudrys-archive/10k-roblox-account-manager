'use strict';
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { logger } = require('./util');
const { parseGraphicsApi } = require('./fflags');
const { parseLogVersion } = require('./runlog');

const log = logger('logwatch');
const LOG_DIR = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs');

// Disconnect reason codes as shown in Roblox's "Disconnected" dialog.
const REASONS = {
  260: 'problem receiving data', 264: 'same account launched elsewhere', 266: 'connection timed out',
  267: 'kicked from the experience', 268: 'kicked for unexpected client behavior', 271: 'server shut down',
  272: 'disconnected (content error)', 273: 'same account launched elsewhere', 274: 'server is shutting down',
  277: 'lost connection to the server', 278: 'disconnected for being idle', 279: 'failed to connect',
  285: 'left the game', 286: 'server full / unavailable', 288: 'experience restricted',
};
const SAME_ACCOUNT = new Set([264, 273]);
// Roblox refused the sign-in ticket. The client logs this and quits.
// A client whose join request Roblox answered with a challenge (HTTP 403 on join-game, flagged challengedByGcs) never gets into the game: the account needs a check.
// VerifyPatch is an unrelated feature name. The client UI calling account-unlock-api and getting "Challenge required" is NOT excluded:
// the one account that logged it was moderated by Roblox minutes later, so it is a real signal (main.js re-checks the account).
const NOT_A_VERIFICATION_RE = /VerifyPatch/i;
const JOIN_CHALLENGE_RE = /status:403\b[^\r\n]*gamejoin\.roblox\.com\/v1\/join-game[^\r\n]*challengedByGcs/i;
const isJoinChallenge = (line) => JOIN_CHALLENGE_RE.test(String(line));
const AUTH_FAIL_RE = /WebLogin authentication is failed|WebLogin HTTP error, statusCode: 403/;
// A captcha / security check shown inside the Roblox client.
const VERIFY_RE = /\b(?:captcha|funcaptcha|arkose|rblx-challenge|challengeRequired|challenge (?:is )?required|human verification|verify (?:that )?you(?:'re| are) (?:a )?human)\b/i;

/**
 * Tails each managed client's own Roblox log. A log is tied to its client by the unique launch tag
 * we pass (it appears as suggestedBrowserTrackerId=<btid>), so this never confuses clients.
 *
 * Gives near-instant knowledge of:
 *   - "! Joining game '<jobId>' place <placeId>"  -> in game, exact server
 *   - "Disconnection Notification. Reason: N" / "Connection lost" / "Sending disconnect with reason: N"
 * Roblox teleports also disconnect briefly, so callers should only act when a disconnect is NOT
 * followed by a new join within a grace period while the process is still alive.
 */
class LogWatcher extends EventEmitter {
  constructor({ launcher, dir = LOG_DIR }) {
    super();
    this.launcher = launcher;
    this.dir = dir;
    this.claimed = new Set(); // log files already tied to an instance
    this.files = new Map();   // pid -> {file, offset, rest}
    this.headCache = new Map(); // full path -> first 96KB of a recent log (only kept while non-empty)
    this.side = new Map();    // full path -> {btid, file, offset, rest}: the second log of a launch (starter + client)
    this.on('authfail', (inst) => {
      if (this.launcher && typeof this.launcher.retryAuth === 'function') {
        this.launcher.retryAuth(inst).catch((e) => log.error('sign-in retry: ' + e.message));
      }
    });
  }

  start() {
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { log.debug(e.message); } }, 2000);
    this.launcher.on('exit', (inst) => { const f = this.files.get(inst.pid); if (f) this.files.delete(inst.pid); });
  }

  tick() {
    const insts = [...this.launcher.instances.values()];
    const unmatched = insts.filter((i) => !this.files.has(i.pid) && i.btid && !i.logMissing);
    if (unmatched.length) this.match(unmatched);
    for (const inst of insts) {
      const f = this.files.get(inst.pid);
      if (f) this.read(inst, f);
    }
    for (const [full, sf] of this.side) {
      const inst = insts.find((i) => i.btid === sf.btid);
      if (!inst) { this.side.delete(full); continue; }
      this.readSide(inst, sf);
    }
  }

  match(insts) {
    let names;
    try { names = fs.readdirSync(this.dir); } catch { return; }
    const cands = [];
    for (const n of names) {
      if (!/_Player_[0-9A-F]+_last\.log$/i.test(n) || /Crash/i.test(n)) continue;
      const full = path.join(this.dir, n);
      if (this.claimed.has(full)) continue;
      try { const st = fs.statSync(full); cands.push({ full, mtime: st.mtimeMs, birth: st.birthtimeMs }); } catch {}
    }
    for (const k of [...this.headCache.keys()]) if (!cands.some((c) => c.full === k)) this.headCache.delete(k);
    for (const inst of insts) {
      const since = (inst.startedAt || 0) - 120000;
      for (const c of cands) {
        if (this.claimed.has(c.full) || c.mtime < since) continue;
        // the header is written once at launch: read each recent log's head once, not every 2s tick
        let head = this.headCache.get(c.full) || '';
        if (!head) try {
          const fd = fs.openSync(c.full, 'r');
          const buf = Buffer.alloc(96 * 1024);
          const n = fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          head = buf.toString('utf8', 0, n);
        } catch { continue; }
        // cache only once the header is surely flushed; a partial first read must not hide the tracker id forever
        if (head.length >= 4096 || head.includes('suggestedBrowserTrackerId=')) this.headCache.set(c.full, head);
        if (!head.includes(`suggestedBrowserTrackerId=${inst.btid}`)) continue;
        this.claimed.add(c.full);
        if (this.files.has(inst.pid)) {
          // Roblox's starter and the real client each write their own log for one launch: watch the extra one too
          this.side.set(c.full, { btid: inst.btid, file: c.full, offset: 0, rest: '' });
          continue;
        }
        // replay the whole file once so state (joined server, disconnects) is correct after adoption
        this.files.set(inst.pid, { file: c.full, offset: 0, rest: '' });
        inst.logState = inst.logState || { inGame: false };
        inst.logState.robloxVersion = parseLogVersion(path.basename(c.full));
        log.debug(`pid ${inst.pid} -> ${path.basename(c.full)}`);
      }
      // give up after 3 minutes (e.g. log folder elsewhere); presence checks still cover it
      if (!this.files.has(inst.pid) && Date.now() - inst.startedAt > 180000) inst.logMissing = true;
    }
  }

  read(inst, f) {
    let size;
    try { size = fs.statSync(f.file).size; } catch { return; }
    if (size < f.offset) { f.offset = 0; f.rest = ''; }
    if (size === f.offset) return;
    const len = Math.min(size - f.offset, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    try {
      const fd = fs.openSync(f.file, 'r');
      fs.readSync(fd, buf, 0, len, f.offset);
      fs.closeSync(fd);
    } catch { return; }
    f.offset += len;
    const text = f.rest + buf.toString('utf8');
    const lines = text.split('\n');
    f.rest = lines.pop();
    for (const line of lines) this.parse(inst, line);
  }

  parse(inst, line) {
    const s = inst.logState || (inst.logState = { inGame: false });
    if (isJoinChallenge(line)) {
      // Roblox shows its own challenge page in the client window and the client carries on once it is solved.
      // That is not an account verification: report it, never close the client or flag the account.
      if (!s.joinChallenge) { s.joinChallenge = true; this.emit('joinchallenge', inst, line.slice(0, 300)); }
      return;
    }
    if (AUTH_FAIL_RE.test(line)) {
      if (!s.authFailed) { s.authFailed = true; this.emit('authfail', inst, line.slice(0, 300)); }
      return;
    }
    const api = parseGraphicsApi(line);
    if (api && !s.graphicsApi) { s.graphicsApi = api; this.launcher.emit('change'); }
    let m = line.match(/! Joining game '([0-9a-f-]{36})' place (\d+)/i);
    if (m) {
      Object.assign(s, { inGame: true, jobId: m[1].toLowerCase(), placeId: Number(m[2]), joinedAt: Date.now(), disconnectedAt: 0, code: 0, reason: '', tpFails: 0, rejoinLoop: false });
      this.emit('join', inst, s);
      this.launcher.emit('change');
      return;
    }
    // The account the client actually joined as (written by Roblox on every join).
    m = line.match(/\[FLog::AvatarJoinMetrics\]\s+userId = (\d+)/) || line.match(/game_join_loadtime:.*?\buserid:(\d+)/i);
    if (m) {
      const uid = Number(m[1]);
      if (uid && uid !== s.userId) {
        s.userId = uid;
        this.emit('identity', inst, s);
        this.launcher.emit('change');
      }
      return;
    }
    if (VERIFY_RE.test(line) && !NOT_A_VERIFICATION_RE.test(line) && !s.verification) {
      s.verification = true;
      this.emit('verification', inst, line.slice(0, 300));
      return;
    }
    // Newer clients word the disconnect as text and print no numeric code (seen: kicked / joined from another device).
    m = line.match(/Client has been disconnected with reason: (.+?)\s*$/) || line.match(/Lost connection with reason\s*: (.+?)\s*$/);
    if (m) {
      const txt = m[1];
      if (!s.disconnectedAt) s.disconnectedAt = Date.now();
      s.inGame = false;
      s.reason = /kicked/i.test(txt) ? 'kicked from the game' : /another device/i.test(txt) ? 'same account launched elsewhere' : txt.slice(0, 120);
      this.emit('disconnect', inst, s);
      this.launcher.emit('change');
      return;
    }
    // After a disconnect the client retries the join about once a second. Repeated rejections without a
    // single successful join mean the retry will never work (account moderated, place closed): mark it dead.
    if (/raiseTeleportInitFailedEvent: Teleport failed because/.test(line)) {
      s.tpFails = (s.tpFails || 0) + 1;
      if (s.tpFails >= 10 && !s.rejoinLoop) {
        s.rejoinLoop = true;
        s.inGame = false;
        if (!s.disconnectedAt) s.disconnectedAt = Date.now();
        s.reason = 'reconnect failing (join rejected, account may be moderated)';
        this.emit('disconnect', inst, s);
        this.launcher.emit('change');
      }
      return;
    }
    // Idle kicks (278) never print "Disconnection Notification"; the replicator records the reason first.
    m = line.match(/Disconnection Notification\. Reason: (\d+)|Sending disconnect with reason: (\d+)|Client:Disconnect setting replicator disconnect reason to (\d+)/);
    if (m || /\[FLog::Network\] Connection lost/.test(line)) {
      const code = m ? Number(m[1] || m[2] || m[3]) : (s.code || 0);
      if (!s.disconnectedAt) s.disconnectedAt = Date.now();
      if (code && (!s.code || s.code === 285)) s.code = code; // keep the most meaningful code
      s.inGame = false;
      s.reason = REASONS[s.code] || (s.code ? `code ${s.code}` : 'connection lost');
      this.emit('disconnect', inst, s);
      this.launcher.emit('change');
    }
  }

  readSide(inst, sf) {
    let size;
    try { size = fs.statSync(sf.file).size; } catch { return; }
    if (size < sf.offset) { sf.offset = 0; sf.rest = ''; }
    if (size === sf.offset) return;
    const len = Math.min(size - sf.offset, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    try {
      const fd = fs.openSync(sf.file, 'r');
      fs.readSync(fd, buf, 0, len, sf.offset);
      fs.closeSync(fd);
    } catch { return; }
    sf.offset += len;
    const lines = (sf.rest + buf.toString('utf8')).split('\n');
    sf.rest = lines.pop();
    for (const line of lines) {
      if (AUTH_FAIL_RE.test(line)) { this.emit('authfail', inst, line.slice(0, 300)); return; }
    }
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { LogWatcher, REASONS, SAME_ACCOUNT, LOG_DIR, VERIFY_RE, NOT_A_VERIFICATION_RE, isJoinChallenge };
