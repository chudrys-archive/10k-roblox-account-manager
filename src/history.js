'use strict';

const MAX_PER_ACCOUNT = 80;

/**
 * Per-account timeline of what happened to an account this session: launches, joined servers,
 * disconnects with Roblox's reason code, restarts, verification requests, identity checks and
 * keep-alive pauses. Kept in memory only, so it starts empty after the manager restarts.
 */
class History {
  constructor() { this.byAccount = new Map(); }

  add(accountId, kind, msg) {
    if (!accountId) return;
    let list = this.byAccount.get(accountId);
    if (!list) { list = []; this.byAccount.set(accountId, list); }
    list.push({ t: Date.now(), kind: String(kind), msg: String(msg || '').slice(0, 300) });
    if (list.length > MAX_PER_ACCOUNT) list.splice(0, list.length - MAX_PER_ACCOUNT);
  }

  /** The newest entry for an account, or null. */
  last(accountId) {
    const list = this.byAccount.get(accountId);
    return list && list.length ? list[list.length - 1] : null;
  }

  /** The newest entry whose kind is in kinds, or null. */
  lastOf(accountId, kinds) {
    const list = this.byAccount.get(accountId) || [];
    for (let i = list.length - 1; i >= 0; i--) if (kinds.includes(list[i].kind)) return list[i];
    return null;
  }

  /** Newest first. */
  list(accountId) { return (this.byAccount.get(accountId) || []).slice().reverse(); }
}

// "left the game" (285) is what Roblox writes at every teleport and rejoin; it is only worth a history line (and a Last error
// entry) when the client does not join a server again shortly after.
const TELEPORT_CODE = 285;
const TELEPORT_SETTLE_MS = 15000;

/**
 * Records a disconnect seen in a client's log. Real reasons (kicked, server full, idle, ...) are recorded at once; the teleport
 * code is recorded only if the client is still out of game after settleMs. ls is the client's live log state, so a join in between
 * clears it. setTimer exists for tests.
 */
function recordDisconnect(history, accountId, ls, { settleMs = TELEPORT_SETTLE_MS, setTimer = setTimeout } = {}) {
  if (!ls || !ls.disconnectedAt || ls.reportedAt === ls.disconnectedAt) return false; // Roblox writes several lines per disconnect
  const stamp = ls.disconnectedAt;
  ls.reportedAt = stamp;
  const say = () => history.add(accountId, 'disconnect', `${ls.reason}${ls.code ? ` (code ${ls.code})` : ''}`);
  if (ls.code !== TELEPORT_CODE) { say(); return true; }
  const t = setTimer(() => { if (!ls.inGame && ls.disconnectedAt === stamp) say(); }, settleMs);
  if (t && typeof t.unref === 'function') t.unref();
  return true;
}

module.exports = { History, MAX_PER_ACCOUNT, recordDisconnect, TELEPORT_CODE, TELEPORT_SETTLE_MS };
