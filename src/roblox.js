'use strict';
const { sleep, logger } = require('./util');

const log = logger('roblox');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class RobloxError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; }
}

/**
 * A session = { cookie, csrf, onCookie(newCookie) }.
 * Handles: CSRF token negotiation, 429 backoff with Retry-After, 5xx/network retries,
 * and Roblox cookie rotation (any Set-Cookie .ROBLOSECURITY is captured and persisted).
 */
async function request(session, method, url, opts = {}) {
  const { body, headers = {}, retries = 3, returnResponse = false, timeoutMs = 20000 } = opts;
  session = session || {};
  let csrfRetried = false;
  for (let attempt = 0; ; attempt++) {
    const h = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers };
    if (session.cookie) h.Cookie = `.ROBLOSECURITY=${session.cookie}`;
    if (session.csrf && method !== 'GET') h['x-csrf-token'] = session.csrf;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, {
        method, headers: h, redirect: 'manual',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new RobloxError(`Network error: ${e.cause?.code || e.message}`, 0);
    }
    captureCookie(session, res);
    const token = res.headers.get('x-csrf-token');
    if (res.status === 403 && token && !csrfRetried) {
      session.csrf = token; csrfRetried = true; attempt--; continue;
    }
    if (res.status === 429 && attempt < retries) {
      const ra = Number(res.headers.get('retry-after')) || 0;
      const wait = Math.max(ra * 1000, 2000 * 2 ** attempt) + Math.random() * 500;
      log.debug(`429 on ${url}, waiting ${Math.round(wait)}ms`);
      await sleep(wait); continue;
    }
    if (res.status >= 500 && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
    if (returnResponse) return res;
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const m = (data && data.errors && data.errors[0] && data.errors[0].message) || res.statusText || 'error';
      const u = new URL(url);
      throw new RobloxError(`${method} ${u.host}${u.pathname} -> ${res.status} ${m}`, res.status, data);
    }
    return data;
  }
}

function captureCookie(session, res) {
  let list = [];
  try { list = res.headers.getSetCookie ? res.headers.getSetCookie() : []; } catch {}
  for (const c of list) {
    if (!c.startsWith('.ROBLOSECURITY=')) continue;
    const val = c.slice('.ROBLOSECURITY='.length).split(';')[0];
    if (val && val !== session.cookie && val.length > 50) {
      session.cookie = val;
      try { session.onCookie && session.onCookie(val); } catch {}
    }
  }
}

// ---------------- endpoints ----------------
const api = {
  request,

  getAuthenticated: (s) => request(s, 'GET', 'https://users.roblox.com/v1/users/authenticated'),

  getRobux: async (s, userId) => (await request(s, 'GET', `https://economy.roblox.com/v1/users/${userId}/currency`)).robux,

  /** Non-empty => account is under moderation (banned/warned). */
  getModeration: async (s) => {
    try {
      const r = await request(s, 'GET', 'https://usermoderation.roblox.com/v1/not-approved', { retries: 1 });
      return r && Object.keys(r).length ? r : null;
    } catch { return null; }
  },

  /** One-time ticket the client exchanges for a session. Never triggers a captcha. */
  async getAuthTicket(s) {
    const res = await request(s, 'POST', 'https://auth.roblox.com/v1/authentication-ticket/', {
      body: {}, returnResponse: true,
      headers: { Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com', RBXAuthenticationNegotiation: '1' },
    });
    const ticket = res.headers.get('rbx-authentication-ticket');
    if (!ticket) {
      const t = await res.text().catch(() => '');
      throw new RobloxError(`Could not get auth ticket (HTTP ${res.status})${res.status === 401 ? ' - cookie invalid/expired' : ''} ${t.slice(0, 200)}`, res.status);
    }
    return ticket;
  },

  /**
   * Mint a fresh session cookie from the current one (ticket -> redeem).
   * The old cookie keeps working until Roblox expires it, so this is safe.
   */
  async refreshCookie(s) {
    const ticket = await api.getAuthTicket(s);
    const fresh = {};
    const res = await request(fresh, 'POST', 'https://auth.roblox.com/v1/authentication-ticket/redeem', {
      body: { authenticationTicket: ticket }, returnResponse: true,
      headers: { RBXAuthenticationNegotiation: '1', Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com' },
    });
    if (!fresh.cookie) throw new RobloxError(`Cookie refresh failed (HTTP ${res.status})`, res.status);
    return fresh.cookie;
  },

  logout: (s) => request(s, 'POST', 'https://auth.roblox.com/v2/logout', { body: {} }),

  async getPresence(s, userIds) {
    const r = await request(s, 'POST', 'https://presence.roblox.com/v1/presence/users', { body: { userIds } });
    return r.userPresences || [];
  },

  async usernameToUser(s, username) {
    const r = await request(s, 'POST', 'https://users.roblox.com/v1/usernames/users', {
      body: { usernames: [username], excludeBannedUsers: false },
    });
    const u = r.data && r.data[0];
    if (!u) throw new RobloxError(`User "${username}" not found`, 404);
    return u; // {id, name, displayName}
  },

  async getUser(s, userId) {
    return request(s, 'GET', `https://users.roblox.com/v1/users/${userId}`);
  },

  async headshots(s, userIds) {
    const out = {};
    for (let i = 0; i < userIds.length; i += 100) {
      const chunk = userIds.slice(i, i + 100);
      const r = await request(s, 'GET', `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${chunk.join(',')}&size=48x48&format=Png&isCircular=false`);
      for (const d of r.data || []) if (d.imageUrl) out[d.targetId] = d.imageUrl;
    }
    return out;
  },

  async getServers(s, placeId, { cursor = '', sortOrder = 'Desc', excludeFull = true, type = 'Public' } = {}) {
    const q = new URLSearchParams({ sortOrder, limit: '100', excludeFullGames: String(excludeFull) });
    if (cursor) q.set('cursor', cursor);
    return request(s, 'GET', `https://games.roblox.com/v1/games/${placeId}/servers/${type}?${q}`);
  },

  async getUniverseId(s, placeId) {
    const r = await request(s, 'GET', `https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    return r.universeId;
  },

  async getGameInfo(s, placeId) {
    const universeId = await api.getUniverseId(s, placeId);
    if (!universeId) return null;
    const r = await request(s, 'GET', `https://games.roblox.com/v1/games?universeIds=${universeId}`);
    const g = r.data && r.data[0];
    let icon = '';
    try { icon = (await api.gameIcons(s, [universeId]))[universeId] || ''; } catch {}
    return g ? { universeId, name: g.name, playing: g.playing, maxPlayers: g.maxPlayers, rootPlaceId: g.rootPlaceId, icon } : { universeId, icon };
  },

  async gameIcons(s, universeIds) {
    const r = await request(s, 'GET', `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeIds.join(',')}&size=150x150&format=Png&isCircular=false`);
    const out = {};
    for (const d of r.data || []) if (d.imageUrl) out[d.targetId] = d.imageUrl;
    return out;
  },

  /** Resolve roblox.com/share?code=...&type=Server links to { placeId, linkCode }. */
  async resolveShareLink(s, code, linkType = 'Server') {
    const r = await request(s, 'POST', 'https://apis.roblox.com/sharelinks/v1/resolve-link', { body: { linkId: code, linkType } });
    const d = r.privateServerInviteData || r.experienceInviteData;
    if (!d) throw new RobloxError('Share link could not be resolved (expired or no access)', 400, r);
    if (d.status && d.status !== 'Valid') throw new RobloxError(`Share link status: ${d.status}`, 400, r);
    return { placeId: d.placeId, linkCode: d.linkCode, instanceId: d.instanceId };
  },

  /** Send a friend request from one account to a user. */
  sendFriendRequest: (s, targetUserId) =>
    request(s, 'POST', `https://friends.roblox.com/v1/users/${targetUserId}/request-friendship`, { body: { friendshipOriginSourceType: 0 } }),

  acceptFriendRequest: (s, requesterId) =>
    request(s, 'POST', `https://friends.roblox.com/v1/users/${requesterId}/accept-friend-request`, { body: {} }),

  setDisplayName: (s, userId, newDisplayName) =>
    request(s, 'PATCH', `https://users.roblox.com/v1/users/${userId}/display-names`, { body: { newDisplayName } }),
};

module.exports = { api, RobloxError, UA };
