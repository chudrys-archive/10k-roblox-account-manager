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

  /** Newest first. */
  list(accountId) { return (this.byAccount.get(accountId) || []).slice().reverse(); }
}

module.exports = { History, MAX_PER_ACCOUNT };
