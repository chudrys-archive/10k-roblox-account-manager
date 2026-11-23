'use strict';
/* Isa's Roblox Account Manager – UI. Vanilla JS; all state comes from the local service over SSE. */

// ============================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('iram_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('iram_' + k, JSON.stringify(v)); } catch {} },
};

const ICONS = {
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h9M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  hop: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  min: '<path d="M5 18h14"/>',
  hex: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
};
const FILLED = new Set(['play']);
const icon = (n) => `<svg class="i${FILLED.has(n) ? ' fill' : ''}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
function hydrateIcons(root = document) {
  for (const s of root.querySelectorAll('svg[data-icon]')) {
    const n = s.dataset.icon;
    s.setAttribute('viewBox', '0 0 24 24');
    s.innerHTML = ICONS[n] || '';
    if (FILLED.has(n)) s.classList.add('fill');
    s.removeAttribute('data-icon');
  }
}
hydrateIcons();

async function call(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}

function toast(type, msg) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div>${esc(msg)}</div>`;
  el.title = 'Click to dismiss';
  el.addEventListener('click', () => el.remove());
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 5) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), type === 'error' ? 12000 : 5000);
}

/** Bind an async handler: disables the control while running, toasts errors. */
function bind(el, fn) {
  el.addEventListener('click', async (ev) => {
    if (el.disabled) return;
    el.disabled = true;
    try { await fn(ev); } catch (e) { toast('error', e.message); } finally { el.disabled = false; }
  });
}
async function run(fn) { try { return await fn(); } catch (e) { toast('error', e.message); } }

const fmtAgo = (ts) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};
const fmtDur = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const fmtIn = (ts) => {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return 'now';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());

// ============================================================ dialogs & menus
function openDialog(html, { wide = false } = {}) {
  closeDialog();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'dialog';
  ov.innerHTML = `<div class="dialog" style="${wide ? 'width:720px' : ''}">${html}</div>`;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeDialog(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDialog(); });
  document.body.appendChild(ov);
  hydrateIcons(ov);
  const f = ov.querySelector('input:not([type=checkbox]),textarea,select');
  if (f) setTimeout(() => f.focus(), 30);
  return ov;
}
function closeDialog() { $('#dialog')?.remove(); }

function confirmDialog(title, text, { ok = 'Confirm', danger = false, check = '' } = {}) {
  return new Promise((resolve) => {
    const d = openDialog(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
      ${check ? `<label class="check" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="cf-check"> ${esc(check)}</label>` : ''}
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(ok)}</button></div>`);
    $('#cf-ok', d).addEventListener('click', () => {
      const checked = !!$('#cf-check', d)?.checked;
      closeDialog(); resolve(check ? { checked } : true);
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(d)) { obs.disconnect(); resolve(false); } });
    obs.observe(document.body, { childList: true });
    setTimeout(() => $('#cf-ok', d)?.focus(), 30);
  });
}

function promptDialog(title, { value = '', placeholder = '', ok = 'Save', type = 'text', hint = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const d = openDialog(`<h2>${esc(title)}</h2>${hint ? `<p class="lead">${esc(hint)}</p>` : ''}
      <input id="pr-v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" style="margin-top:8px">
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pr-ok">${esc(ok)}</button></div>`);
    const finish = () => { done = true; const v = $('#pr-v', d).value; closeDialog(); resolve(v); };
    $('#pr-ok', d).addEventListener('click', finish);
    $('#pr-v', d).addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    const obs = new MutationObserver(() => { if (!document.body.contains(d)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

function closeMenu() { $('#menu')?.remove(); }
function openMenu(x, y, items, up = false) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.id = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.header ? `<div class="hd">${esc(it.header)}</div>`
    : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : '<span style="width:16px"></span>'}${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.max(8, up ? y - r.height - 6 : Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    run(items[Number(b.dataset.i)].fn);
  });
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) closeMenu(); });
window.addEventListener('blur', closeMenu);

// ============================================================ state
let S = null;
const selected = new Set(store.get('selected', []));
let lastClicked = null;
let sortKey = store.get('sortKey', 'order');
let sortDir = store.get('sortDir', 1);
let groupFilter = store.get('group', '');
const logs = [];
let errCount = 0;

const accById = (id) => S && S.accounts.find((a) => a.id === id);
const nameOf = (a) => a.alias || a.username || String(a.userId);
const instOf = (id) => S && S.launcher.instances.find((i) => i.accountId === id);
function selIds() { return S ? S.accounts.filter((a) => selected.has(a.id)).map((a) => a.id) : []; }
function needSel() { const ids = selIds(); if (!ids.length) throw new Error('Select one or more accounts first'); return ids; }
function launchInput() { return { input: $('#launch-input').value.trim(), jobId: $('#launch-job').value.trim() }; }

// ============================================================ tabs
function showTab(name) {
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  store.set('tab', name);
  if (name === 'logs') { errCount = 0; renderNav(); renderLogs(); }
  if (name === 'settings') renderSettings();
}
$$('.nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab(store.get('tab', 'accounts'));

// ============================================================ live connection
function connect() {
  const es = new EventSource('/ui/events');
  es.addEventListener('state', (e) => { S = JSON.parse(e.data); render(); });
  es.addEventListener('log', (e) => {
    const l = JSON.parse(e.data);
    logs.push(l); if (logs.length > 2000) logs.shift();
    if (l.level === 'error' && store.get('tab') !== 'logs') { errCount++; renderNav(); }
    if ($('#tab-logs').classList.contains('active')) renderLogs();
  });
  es.addEventListener('toast', (e) => { const t = JSON.parse(e.data); toast(t.type, t.msg); });
  es.onopen = () => $('#side-status')?.classList.remove('err');
  es.onerror = () => { $('#side-status').innerHTML = '<div class="row"><span class="dot err"></span>Disconnected – is the manager running?</div>'; };
}
call('/ui/logs').then((l) => logs.push(...l)).catch(() => {});
connect();
setInterval(() => { if (S && !S.locked) { renderStats(); renderAfk(); } }, 1000);
setInterval(() => { if (S && !S.locked) renderTable(); }, 10000);

function render() {
  $('#lock').classList.toggle('hidden', !S.locked);
  if (S.locked) { $('#unlock-pw').focus(); return; }
  for (const id of [...selected]) if (!accById(id)) selected.delete(id);
  renderNav();
  renderSide();
  renderStats();
  renderChips();
  renderTable();
  renderSelbar();
  renderFavs();
  renderAfk();
  renderWindows();
  renderGuard();
  if (!settingsDirty && $('#tab-settings').classList.contains('active')) renderSettings();
}

// captcha guard banner: shown while a captcha has paused all automatic activity
function renderGuard() {
  const g = S.captchaGuard;
  const el = $('#guard-banner');
  if (!g || !g.paused) { el.classList.add('hidden'); if (el.dataset.on) { el.innerHTML = ''; delete el.dataset.on; } return; }
  el.dataset.on = '1';
  el.classList.remove('hidden');
  el.innerHTML = `<div><b>Automation paused by the captcha guard.</b> ${g.account ? `${esc(g.account)} hit a captcha or verification at ${new Date(g.since).toLocaleTimeString()}. ` : ''}Keep-alive rejoins, restarts, server hops and API launches are stopped for every account. Open the flagged account in the browser, complete the check, click Validate, then resume.${g.resumeAt ? ` Resumes by itself at ${new Date(g.resumeAt).toLocaleTimeString()}.` : ''}</div>
    <div class="btn-row" style="margin-top:10px"><button class="btn primary sm" id="guard-resume">${icon('play')}Resume automation</button></div>`;
}
$('#guard-banner').addEventListener('click', (e) => {
  if (e.target.closest('#guard-resume')) run(() => call('/ui/captcha-guard/resume', {}));
});

function renderNav() {
  if (!S) return;
  $('#nav-acc').textContent = S.accounts.length || '';
  $('#nav-err').textContent = errCount ? `${errCount}` : '';
  $('#nav-err').style.color = errCount ? 'var(--err)' : '';
}

function renderSide() {
  const m = S.launcher.multi;
  const multi = !m || !m.wanted ? ['', 'Multi-instance off'] : m.mutex === 'held' ? ['ok', 'Multi-instance active'] : ['warn', 'Multi-instance waiting'];
  const wd = S.settings.watchdog.enabled;
  $('#side-status').innerHTML = `
    <div class="row" title="${esc(m && m.mutex !== 'held' && m.wanted ? 'A Roblox client started outside the manager owns the lock. Close all Roblox windows once.' : '')}"><span class="dot ${multi[0]}"></span>${multi[1]}</div>
    <div class="row"><span class="dot ${S.roblox ? 'ok' : 'err'}"></span>${S.roblox ? 'Roblox detected' : 'Roblox not found'}</div>
    <div class="row"><span class="dot ${wd ? 'ok' : ''}"></span>Watchdog ${wd ? 'on' : 'paused'}</div>`;
}

function renderStats() {
  const acc = S.accounts;
  const valid = acc.filter((a) => a.status === 'valid').length;
  const bad = acc.filter((a) => a.status === 'invalid' || a.status === 'banned').length;
  const verify = acc.filter((a) => a.status === 'verify').length;
  const inst = S.launcher.instances;
  const mem = inst.reduce((s, i) => s + (i.memMB || 0), 0);
  const ka = acc.filter((a) => a.keepAlive.enabled);
  const kaIssues = ka.filter((a) => ['error', 'throttled', 'waiting'].includes(S.watchdog[a.id]?.status)).length;
  const robux = acc.reduce((s, a) => s + (a.robux || 0), 0);
  const afk = S.antiAfk;
  const afkVal = !afk.enabled ? 'Off' : afk.nextDue ? fmtIn(afk.nextDue) : 'Idle';
  const afkHint = !afk.enabled ? 'clients may be kicked after 20 min' : afk.status || (afk.nextDue ? 'until next nudge' : 'no clients running');
  const cards = [
    ['users', 'Accounts', acc.length, `${valid} valid${bad ? ` · <span class="err">${bad} need login</span>` : ''}${verify ? ` · <span class="err">${verify} need verification</span>` : ''}`],
    ['play', 'Running', inst.length, inst.length ? `${(mem / 1024).toFixed(1)} GB RAM · queue ${S.launcher.queued.length}` : `queue ${S.launcher.queued.length}`],
    ['shield', 'Keep-alive', ka.length, kaIssues ? `<span style="color:var(--warn)">${kaIssues} recovering</span>` : 'all healthy'],
    ['zap', 'Anti-AFK', afkVal, esc(afkHint)],
    ['hex', 'Robux', fmtNum(robux), 'across all accounts'],
    ['cpu', 'Untracked', S.launcher.unknown.length, 'Roblox windows not started here'],
  ];
  const t = `${inst.length ? `(${inst.length}) ` : ''}Isa's Roblox Account Manager`;
  if (document.title !== t) document.title = t;
  $('#stats').innerHTML = cards.map(([ic, l, v, h]) => `<div class="stat"><div class="label">${icon(ic)}${l}</div><div class="val">${v}</div><div class="hint">${h}</div></div>`).join('');
}

// ============================================================ accounts table
function renderChips() {
  const groups = [...new Set(S.accounts.map((a) => a.group))].sort();
  if (groupFilter && !groups.includes(groupFilter)) groupFilter = '';
  $('#group-chips').innerHTML = groups.length > 1
    ? [`<span class="chip ${!groupFilter ? 'on' : ''}" data-g="">All</span>`, ...groups.map((g) => `<span class="chip ${g === groupFilter ? 'on' : ''}" data-g="${esc(g)}">${esc(g)} <span class="muted">${S.accounts.filter((a) => a.group === g).length}</span></span>`)].join('')
    : '';
}
$('#group-chips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-g]'); if (!c) return;
  groupFilter = c.dataset.g; store.set('group', groupFilter); renderChips(); renderTable();
});

function visibleAccounts() {
  const f = $('#filter').value.trim().toLowerCase();
  let list = S.accounts.filter((a) => (!groupFilter || a.group === groupFilter)
    && (!f || [a.username, a.alias, a.displayName, a.group, a.description, String(a.userId)].some((x) => (x || '').toLowerCase().includes(f))));
  const key = {
    order: (a) => a.order, name: (a) => String(nameOf(a)).toLowerCase(), group: (a) => a.group.toLowerCase(),
    status: (a) => a.status, robux: (a) => a.robux ?? -1, client: (a) => (instOf(a.id) ? 0 : 1),
  }[sortKey] || ((a) => a.order);
  return list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
}

function clientCell(a) {
  const inst = instOf(a.id);
  const wd = S.watchdog[a.id];
  if (inst) {
    const lg = inst.log;
    const disconnected = lg && !lg.inGame && lg.disconnectedAt;
    const pres = wd?.presence;
    const presLoc = pres && pres.userPresenceType === 2 ? pres.lastLocation : '';
    const presWarn = pres && (pres.userPresenceType === 0 || pres.userPresenceType === 1) && lg?.inGame ? ' · Roblox reports not in game – rechecking' : '';
    const loc = disconnected ? `Disconnected: ${lg.reason}` : (presLoc || (lg?.jobId ? `Server ${lg.jobId.slice(0, 8)}` : inst.target?.label) || '') + presWarn;
    const afk = S.antiAfk.per[inst.pid];
    const afkTxt = !disconnected && S.antiAfk.enabled && afk && a.fields?.antiAfk !== 'off' ? ` · AFK nudge ${fmtIn(afk.next)}` : '';
    const badge = disconnected ? '<span class="badge error">Disconnected</span>' : lg && !lg.inGame ? '<span class="badge waiting">Joining…</span>' : '<span class="badge running">In game</span>';
    const ver = inst.verified === true ? ' <span class="okc small" title="Roblox log confirms this client is signed in as this account">✔ verified</span>'
      : inst.verified === false ? ' <b class="err small">WRONG ACCOUNT</b>' : '';
    return `<div class="client"><span>${badge}${ver} <span class="muted small">${fmtDur(Date.now() - inst.startedAt)} · ${inst.memMB ?? '?'} MB${inst.muted ? ' · muted' : ''}${inst.hung ? ' · <b class="err">not responding</b>' : ''}</span></span>
      <span class="loc ${disconnected ? 'err' : ''}" title="${esc(loc)}">${esc(loc)}${esc(afkTxt)}</span></div>`;
  }
  const qi = S.launcher.queued.indexOf(a.id);
  if (qi === 0) return '<span class="badge queued">Launching…</span>';
  if (qi > 0) return `<span class="badge queued qpos">Queued #${qi}</span>`;
  if (a.status === 'verify') return '<div class="client"><span class="badge verify">needs verification</span><span class="loc muted">client closed · verify in browser, then Validate</span></div>';
  const pr = a.presence;
  const prTxt = pr ? ['Offline', 'Online', 'In game', 'In Studio', 'Invisible'][pr.type] || 'Offline' : 'Offline';
  const prLoc = pr && pr.type === 2 && pr.location ? `${pr.location} (elsewhere)` : `last played ${fmtAgo(a.lastUsedAt)}`;
  return `<div class="client"><span class="muted" title="Live presence from Roblox">${esc(prTxt)}</span><span class="loc muted">${esc(prLoc)}</span></div>`;
}

function kaCell(a) {
  const wd = S.watchdog[a.id];
  const on = a.keepAlive.enabled;
  const st = on ? (wd?.status || 'waiting') : '';
  const label = { running: 'healthy', launching: 'launching', waiting: 'recovering', throttled: 'throttled', error: 'error', paused: 'paused' }[st] || st;
  return `<div style="display:flex;align-items:center;gap:8px"><label class="switch" title="${on ? esc('Target: ' + (a.keepAlive.target?.label || '')) : 'Keep this account in game automatically'}"><input type="checkbox" data-ka ${on ? 'checked' : ''}><span></span></label>
    ${on ? `<span class="badge ${esc(st)}" title="${esc(wd?.msg || '')}">${esc(label)}</span>` : wd?.msg ? `<span class="err small" title="${esc(wd.msg)}">${esc(wd.msg.slice(0, 40))}</span>` : ''}</div>`;
}

function renderTable() {
  if (!S || dragId) return; // don't rebuild rows under an active drag
  const list = visibleAccounts();
  const draggable = sortKey === 'order' && !groupFilter && !$('#filter').value.trim();
  $$('#acc-table th[data-sort]').forEach((th) => {
    th.querySelector('.arrow')?.remove();
    if (th.dataset.sort === sortKey) th.insertAdjacentHTML('beforeend', ` <span class="arrow">${sortDir > 0 ? '▲' : '▼'}</span>`);
  });
  const rows = list.map((a) => {
    const inst = instOf(a.id);
    const queued = S.launcher.queued.includes(a.id);
    const initials = esc(String(nameOf(a)).slice(0, 2).toUpperCase());
    return `<tr data-id="${a.id}" class="${selected.has(a.id) ? 'sel' : ''}" ${draggable ? 'draggable="true"' : ''}>
      <td><input type="checkbox" class="cb" data-check ${selected.has(a.id) ? 'checked' : ''}></td>
      <td><div class="acc"><div class="avatar">${a.avatarUrl ? `<img src="${esc(a.avatarUrl)}" alt="" loading="lazy">` : `<div class="ph">${initials}</div>`}<span class="st ${inst ? 'on' : queued ? 'busy' : ''}"></span></div>
        <div style="min-width:0"><div class="nm">${esc(nameOf(a))}</div><div class="meta">${esc(a.alias ? a.username : a.displayName)} · ${a.userId}${a.description ? ' · ' + esc(a.description) : ''}</div></div></div></td>
      <td><span class="tag">${esc(a.group)}</span></td>
      <td><span class="badge ${esc(a.status)}" title="${esc(a.statusMsg || 'checked ' + fmtAgo(a.lastValidatedAt))}">${esc(a.status === 'invalid' ? 'login needed' : a.status === 'verify' ? 'needs verification' : a.status)}</span></td>
      <td>${fmtNum(a.robux)}</td>
      <td>${clientCell(a)}</td>
      <td>${kaCell(a)}</td>
      <td><div class="row-actions">
        ${inst ? `<button class="btn icon sm" data-row="focus" title="Show window">${icon('focus')}</button><button class="btn icon sm" data-row="stop" title="Stop">${icon('stop')}</button>`
               : `<button class="btn icon sm" data-row="launch" title="Launch">${icon('play')}</button>`}
        <button class="btn icon sm" data-row="menu" title="More">${icon('more')}</button></div></td>
    </tr>`;
  }).join('');
  $('#acc-table tbody').innerHTML = rows || (S.accounts.length
    ? '<tr><td colspan="8"><div class="empty">No accounts match this filter.</div></td></tr>'
    : `<tr><td colspan="8"><div class="empty"><b>No accounts yet</b>Click <b style="display:inline">Add account</b> to log in through a browser window or import cookies.</div></td></tr>`);
  $('#sel-all').checked = list.length > 0 && list.every((a) => selected.has(a.id));
  store.set('selected', [...selected]);
}

function renderSelbar() {
  const n = selIds().length;
  $('#selbar').classList.toggle('show', n > 0);
  document.body.classList.toggle('has-sel', n > 0);
  $('#sel-n').textContent = `${n} selected`;
}

function selectionChanged() { renderTable(); renderSelbar(); }

$('#acc-table tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.closest('[data-ka]')) {
    e.preventDefault();
    const a = accById(id);
    return run(() => ACT.keepAlive([id], !a.keepAlive.enabled));
  }
  if (e.target.closest('.switch')) return;
  const rb = e.target.closest('[data-row]');
  if (rb) {
    const what = rb.dataset.row;
    if (what === 'menu') { const r = rb.getBoundingClientRect(); return openMenu(r.left - 170, r.bottom + 4, menuFor([id])); }
    if (what === 'launch') return run(() => ACT.launch([id]));
    if (what === 'stop') return run(() => ACT.stop([id]));
    if (what === 'focus') return run(() => ACT.window(id, 'focus'));
  }
  const visible = visibleAccounts().map((a) => a.id);
  if (e.shiftKey && lastClicked) {
    const [i, j] = [visible.indexOf(lastClicked), visible.indexOf(id)].sort((x, y) => x - y);
    if (i >= 0) visible.slice(i, j + 1).forEach((x) => selected.add(x));
  } else if (e.ctrlKey || e.metaKey || e.target.matches('[data-check]')) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
  } else {
    const only = selected.size === 1 && selected.has(id);
    selected.clear(); if (!only) selected.add(id);
  }
  lastClicked = id;
  selectionChanged();
});
$('#acc-table tbody').addEventListener('dblclick', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr && !e.target.closest('button,.switch,input')) openDetails(tr.dataset.id);
});
$('#acc-table tbody').addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  e.preventDefault();
  const id = tr.dataset.id;
  if (!selected.has(id)) { selected.clear(); selected.add(id); selectionChanged(); }
  openMenu(e.clientX, e.clientY, menuFor(selIds()));
});
$('#sel-all').addEventListener('change', (e) => {
  const vis = visibleAccounts().map((a) => a.id);
  if (e.target.checked) vis.forEach((id) => selected.add(id)); else vis.forEach((id) => selected.delete(id));
  selectionChanged();
});
$$('#acc-table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  if (sortKey === k) { if (sortDir === -1) { sortKey = 'order'; sortDir = 1; } else sortDir = -1; } else { sortKey = k; sortDir = 1; }
  store.set('sortKey', sortKey); store.set('sortDir', sortDir);
  renderTable();
}));
$('#filter').addEventListener('input', renderTable);
const applyDensity = () => { $('#acc-table').classList.toggle('compact', !!store.get('compact', false)); $('#btn-density').classList.toggle('primary', !!store.get('compact', false)); };
$('#btn-density').addEventListener('click', () => { store.set('compact', !store.get('compact', false)); applyDensity(); });
applyDensity();

// drag & drop reorder (only in manual order with no filter)
let dragId = null;
const tbody = $('#acc-table tbody');
tbody.addEventListener('dragstart', (e) => { const tr = e.target.closest('tr[data-id]'); dragId = tr?.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
tbody.addEventListener('dragover', (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr || !dragId) return;
  e.preventDefault();
  $$('tr.drag-over', tbody).forEach((x) => x.classList.remove('drag-over'));
  tr.classList.add('drag-over');
});
tbody.addEventListener('drop', (e) => {
  e.preventDefault();
  const tr = e.target.closest('tr[data-id]');
  $$('tr.drag-over', tbody).forEach((x) => x.classList.remove('drag-over'));
  if (!tr || !dragId || tr.dataset.id === dragId) return;
  const ids = S.accounts.slice().sort((a, b) => a.order - b.order).map((a) => a.id).filter((x) => x !== dragId);
  ids.splice(ids.indexOf(tr.dataset.id), 0, dragId);
  dragId = null;
  run(() => call('/ui/accounts/reorder', { ids }));
});
tbody.addEventListener('dragend', () => { dragId = null; $$('tr.drag-over', tbody).forEach((x) => x.classList.remove('drag-over')); });

// ============================================================ actions
const ACT = {
  async launch(ids) {
    const { input, jobId } = launchInput();
    const r = await call('/ui/launch', { ids, input, jobId, sameServer: $('#same-server').checked });
    toast('info', `Launching ${r.queued} → ${r.target.label}`);
  },
  async stop(ids) {
    const r = await call('/ui/kill', { ids });
    toast('ok', r.killed ? `Stopped ${r.killed} client(s)` : 'Nothing was running');
  },
  async restart(ids) { await call('/ui/restart', { ids }); toast('info', `Restarting ${ids.length} client(s)…`); },
  async hop(ids, preferSmall = false) { await call('/ui/server-hop', { ids, preferSmall }); toast('info', `Finding new servers for ${ids.length} account(s)…`); },
  async keepAlive(ids, on) {
    if (!on) { await call('/ui/keepalive', { ids, enabled: false }); return toast('ok', 'Keep-alive off'); }
    const { input, jobId } = launchInput();
    const r = await call('/ui/keepalive', { ids, enabled: true, input, jobId });
    toast('ok', `Keep-alive on → ${r.target.label}`);
  },
  async window(id, cmd) { const i = instOf(id); if (!i) throw new Error('not running'); await call('/ui/window', { pid: i.pid, cmd }); },
  async group(ids) {
    const v = await promptDialog(`Group for ${ids.length} account(s)`, { value: accById(ids[0])?.group || 'Default', placeholder: 'e.g. Farm, Main, Alts' });
    if (v != null) await call('/ui/accounts/group', { ids, group: v.trim() || 'Default' });
  },
  async validate(ids) {
    toast('info', `Checking ${ids.length || 'all'} account(s)…`);
    const r = await call('/ui/accounts/validate', { ids });
    toast('ok', 'Validated: ' + Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', '));
  },
  async del(ids) {
    if (!await confirmDialog(`Remove ${ids.length} account(s)?`, 'They are removed from the manager only; the Roblox accounts are not affected. Running clients are closed.', { ok: 'Remove', danger: true })) return;
    await call('/ui/accounts/delete', { ids }); ids.forEach((id) => selected.delete(id)); renderSelbar();
  },
  async friend(ids) {
    if (ids.length < 2) throw new Error('Select at least 2 accounts');
    if (!await confirmDialog('Friend each other?', `Sends and accepts friend requests between all ${ids.length} accounts (${ids.length * (ids.length - 1) / 2} pairs).`)) return;
    toast('info', 'Sending friend requests…');
    const r = await call('/ui/accounts/friend-each-other', { ids });
    toast('ok', `Friends: ${r.sent} sent, ${r.accepted} accepted${r.failed ? `, ${r.failed} failed` : ''}`);
  },
  async exportCookies(ids) {
    const d = openDialog(`<h2>Export ${ids.length} account(s)</h2>
      <p class="lead err">Anyone with these cookies can sign in as these accounts. Keep the export private.</p>
      <label class="f">Format</label><select id="ex-fmt"><option value="cookie">Cookie per line</option><option value="full">username:password:cookie</option></select>
      ${S.vaultMode === 'scrypt' ? '<label class="f">Master password</label><input type="password" id="ex-pw">' : ''}
      <textarea id="ex-out" class="hidden" readonly style="margin-top:10px"></textarea>
      <div class="foot"><button class="btn" data-close>Close</button><button class="btn" id="ex-copy" disabled>${icon('copy')}Copy</button><button class="btn primary" id="ex-go">Export</button></div>`);
    bind($('#ex-go', d), async () => {
      const r = await call('/ui/accounts/export', { ids, format: $('#ex-fmt', d).value, password: $('#ex-pw', d)?.value });
      const ta = $('#ex-out', d); ta.value = r.text; ta.classList.remove('hidden'); ta.select(); $('#ex-copy', d).disabled = false;
    });
    bind($('#ex-copy', d), async () => { await navigator.clipboard.writeText($('#ex-out', d).value); toast('ok', 'Copied'); });
  },
  async antiAfkFor(ids, on) {
    for (const id of ids) await call(`/ui/accounts/${id}/update`, { fields: { antiAfk: on ? 'on' : 'off' } });
    toast('ok', `Anti-AFK ${on ? 'enabled' : 'disabled'} for ${ids.length} account(s)`);
  },
  async audio(ids, mode) {
    for (const id of ids) await call(`/ui/accounts/${id}/update`, { fields: { audio: mode } });
    toast('ok', `Audio for ${ids.length} account(s): ${mode === 'mute' ? 'always muted' : mode === 'unmute' ? 'never muted' : 'follows global setting'}`);
  },
  async copy(text, what) { await navigator.clipboard.writeText(String(text)); toast('ok', `${what} copied`); },
  async revealCookie(id) {
    const pw = S.vaultMode === 'scrypt' ? await promptDialog('Master password', { type: 'password', ok: 'Unlock' }) : '';
    if (pw === null) return;
    const r = await call(`/ui/accounts/${id}/reveal`, { password: pw });
    await navigator.clipboard.writeText(r.cookie);
    toast('ok', 'Cookie copied to clipboard');
  },
};

function menuFor(ids) {
  const one = ids.length === 1 ? accById(ids[0]) : null;
  const running = ids.some((id) => instOf(id));
  const kaOn = ids.every((id) => accById(id)?.keepAlive.enabled);
  const afkOff = ids.every((id) => accById(id)?.fields?.antiAfk === 'off');
  const items = [{ header: one ? nameOf(one) : `${ids.length} accounts` },
    { icon: 'play', label: 'Launch', fn: () => ACT.launch(ids) },
    { icon: 'refresh', label: running ? 'Restart' : 'Rejoin last game', fn: () => (running ? ACT.restart(ids) : call('/ui/launch', { ids }).then(() => toast('info', 'Rejoining…'))) },
    { icon: 'hop', label: 'Server hop', fn: () => ACT.hop(ids) },
    { icon: 'hop', label: 'Server hop (emptiest server)', fn: () => ACT.hop(ids, true) },
    ...(running ? [{ icon: 'stop', label: 'Stop', fn: () => ACT.stop(ids) }] : []),
    '-',
    { icon: 'shield', label: kaOn ? 'Keep-alive off' : 'Keep-alive on', fn: () => ACT.keepAlive(ids, !kaOn) },
    { icon: 'zap', label: afkOff ? 'Enable anti-AFK' : 'Disable anti-AFK', fn: () => ACT.antiAfkFor(ids, afkOff) },
    { icon: 'sound', label: 'Audio: always muted', fn: () => ACT.audio(ids, 'mute') },
    { icon: 'sound', label: 'Audio: never muted', fn: () => ACT.audio(ids, 'unmute') },
    { icon: 'sound', label: 'Audio: follow global setting', fn: () => ACT.audio(ids, '') },
  ];
  if (one && instOf(one.id)) items.push({ icon: 'focus', label: 'Show window', fn: () => ACT.window(one.id, 'focus') }, { icon: 'min', label: 'Minimize window', fn: () => ACT.window(one.id, 'minimize') });
  const srv = one && instOf(one.id)?.log;
  if (srv && srv.inGame && srv.jobId) {
    items.push(
      { icon: 'users', label: 'Bring other accounts to this server…', fn: () => bringToServer(one, srv) },
      { icon: 'copy', label: 'Copy server Job ID', fn: () => ACT.copy(srv.jobId, 'Job ID') },
    );
  }
  items.push('-');
  if (one) {
    items.push(
      { icon: 'globe', label: 'Open browser as account', fn: async () => { await call(`/ui/accounts/${one.id}/browser`, {}); toast('ok', 'Browser opened'); } },
      { icon: 'edit', label: 'Details…', fn: () => openDetails(one.id) },
      { icon: 'copy', label: 'Copy username', fn: () => ACT.copy(one.username, 'Username') },
      { icon: 'copy', label: 'Copy user ID', fn: () => ACT.copy(one.userId, 'User ID') },
      { icon: 'key', label: 'Copy cookie', fn: () => ACT.revealCookie(one.id) },
    );
  }
  items.push(
    { icon: 'check', label: 'Validate', fn: () => ACT.validate(ids) },
    { icon: 'tag', label: 'Set group…', fn: () => ACT.group(ids) },
    ...(ids.length > 1 ? [{ icon: 'heart', label: 'Friend each other', fn: () => ACT.friend(ids) }] : []),
    { icon: 'key', label: 'Export cookies…', fn: () => ACT.exportCookies(ids) },
    '-',
    { icon: 'trash', label: 'Remove from manager', danger: true, fn: () => ACT.del(ids) },
  );
  return items;
}

/** Pick accounts to send into the exact server another account is playing in. */
function bringToServer(host, srv) {
  const others = S.accounts.filter((a) => a.id !== host.id && a.status !== 'invalid');
  if (!others.length) return toast('warn', 'No other accounts to bring');
  const d = openDialog(`<h2>Bring accounts to ${esc(nameOf(host))}'s server</h2>
    <p class="lead">Server <span class="mono">${esc(srv.jobId)}</span> · place ${srv.placeId}. Accounts already running are moved over.</p>
    <div style="max-height:320px;overflow:auto;margin-top:6px">${others.map((a) => `<label class="toggle-row" style="cursor:pointer"><input type="checkbox" class="cb" value="${a.id}" ${selected.has(a.id) ? 'checked' : ''}>
      <span class="txt">${esc(nameOf(a))} <small>${instOf(a.id) ? 'running – will be moved' : 'offline'}${a.keepAlive.enabled ? ' · keep-alive follows' : ''}</small></span></label>`).join('')}</div>
    <div class="toggle-row"><label class="switch"><input type="checkbox" id="bt-ka"><span></span></label><div class="txt">Also keep them alive in this server</div></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="bt-go">${icon('play')}Send</button></div>`);
  bind($('#bt-go', d), async () => {
    const ids = $$('input.cb:checked', d).map((x) => x.value);
    if (!ids.length) throw new Error('Pick at least one account');
    const target = { type: 'job', placeId: srv.placeId, jobId: srv.jobId, label: `${nameOf(host)}'s server` };
    if ($('#bt-ka', d).checked) await call('/ui/keepalive', { ids, enabled: true, target });
    await call('/ui/launch', { ids, target });
    toast('info', `Sending ${ids.length} account(s) to ${nameOf(host)}'s server`);
    closeDialog();
  });
}

// selection bar
$('#selbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'clear') { selected.clear(); return selectionChanged(); }
  if (act === 'more') { const r = b.getBoundingClientRect(); return openMenu(r.left, r.top, menuFor(selIds()), true); }
  run(async () => {
    const ids = needSel();
    if (act === 'launch') return ACT.launch(ids);
    if (act === 'stop') return ACT.stop(ids);
    if (act === 'restart') return ACT.restart(ids);
    if (act === 'hop') return ACT.hop(ids);
    if (act === 'ka-on') return ACT.keepAlive(ids, !ids.every((id) => accById(id).keepAlive.enabled));
    if (act === 'group') return ACT.group(ids);
  });
});

// side panel buttons
bind($('#btn-launch'), () => ACT.launch(needSel()));
bind($('#btn-ka-on'), () => ACT.keepAlive(needSel(), true));
bind($('#btn-ka-off'), () => ACT.keepAlive(needSel(), false));
bind($('#btn-validate'), () => ACT.validate(selIds()));
// Cookie checker: validate cookies without adding them
bind($('#btn-check'), async () => {
  const d = openDialog(`<h2>Check cookies</h2><p class="lead">Paste cookies (one per line, any format that contains a .ROBLOSECURITY value). Nothing is saved unless you click Import.</p>
    <textarea id="cc-text" rows="6" placeholder="_|WARNING:-DO-NOT-SHARE-THIS..."></textarea><div id="cc-res"></div>
    <div class="foot"><button class="btn" data-close>Close</button><button class="btn" id="cc-import" disabled>Import valid</button><button class="btn primary" id="cc-go">Check</button></div>`);
  let valid = [];
  $('#cc-go', d).addEventListener('click', () => run(async () => {
    const text = $('#cc-text', d).value;
    $('#cc-res', d).innerHTML = '<p class="muted">Checking…</p>';
    const rows = await call('/ui/accounts/check-cookies', { text });
    const lines = text.split(/\r?\n/).filter((l) => /_\|WARNING|[A-F0-9]{100,}/i.test(l));
    valid = rows.filter((r) => r.valid && r.status !== 'banned').map((r) => lines.find((l) => l.includes(r.tail))).filter(Boolean);
    $('#cc-import', d).disabled = !valid.length;
    $('#cc-res', d).innerHTML = `<p class="muted">${rows.filter((r) => r.valid).length} of ${rows.length} valid</p><table class="ck-table"><tr><th>#</th><th>User</th><th>Status</th><th>Created</th><th>Robux</th><th></th></tr>` +
      rows.map((r) => `<tr><td>${r.n}</td><td>${r.valid ? `${esc(r.username || '?')} <span class="muted small">${r.userId || ''}</span>` : '<span class="err">' + esc(r.error || 'invalid') + '</span>'}</td><td>${esc(r.status)}</td><td>${r.created ? esc(new Date(r.created).toLocaleDateString()) : ''}</td><td>${r.robux ?? ''}</td><td class="muted small">${r.known ? 'already added' : ''}</td></tr>`).join('') + '</table>';
  }));
  $('#cc-import', d).addEventListener('click', () => run(async () => {
    const r = await call('/ui/accounts/import', { text: valid.join('\n') });
    toast('ok', `Imported ${r.added} new, ${r.updated} updated`); closeDialog();
  }));
});
bind($('#btn-tile'), async () => { const r = await call('/ui/tile', {}); toast('ok', `Tiled ${r.tiled} window(s)`); });
bind($('#btn-kill-all'), async () => {
  const ka = S.accounts.filter((a) => a.keepAlive.enabled).length;
  if (!await confirmDialog('Close every Roblox client?', `Includes windows not started by the manager.${ka ? ` ${ka} keep-alive account(s) will be relaunched unless you turn keep-alive off first.` : ''}`, { ok: 'Close all', danger: true })) return;
  const r = await call('/ui/kill', { all: true }); toast('ok', `Closed ${r.killed}`);
});
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#theme-label').textContent = t === 'light' ? 'Dark mode' : 'Light mode';
}
applyTheme(store.get('theme', 'dark'));
$('#btn-theme').addEventListener('click', () => {
  const t = store.get('theme', 'dark') === 'light' ? 'dark' : 'light';
  store.set('theme', t); applyTheme(t);
});
bind($('#btn-quit'), async () => {
  const ka = S.accounts.filter((a) => a.keepAlive.enabled).length;
  const clients = S.launcher.instances.length + S.launcher.unknown.length;
  const text = 'Quitting stops the manager and all of its background processes.' +
    (clients ? ` Your ${clients} Roblox client(s) keep running unless you close them below (keep-alive, anti-AFK and alerts stop until you start the manager again).` : '') +
    (ka ? ` (${ka} account(s) use keep-alive.)` : '');
  const r = await confirmDialog('Quit the manager?', text, { ok: 'Quit', check: clients ? `Also close ${clients} Roblox client(s)` : '' });
  if (!r) return;
  await call('/ui/quit', { closeClients: !!(r && r.checked) });
  document.body.innerHTML = '<div class="lock"><div class="card" style="text-align:center;width:360px"><div class="logo" style="margin:0 auto 14px">IR</div><h2 style="margin:0 0 6px">Manager stopped</h2><p class="muted">Start it again with the desktop shortcut or "Start Manager.vbs". You can close this window.</p></div></div>';
});
bind($('#btn-afk-now'), async () => { const r = await call('/ui/antiafk/now', {}); toast('ok', r.nudged ? `Nudged ${r.nudged} client(s)` : 'No clients to nudge'); });
$('#afk-toggle').addEventListener('change', (e) => run(async () => {
  await call('/ui/settings', { antiAfk: { enabled: e.target.checked } });
  toast('ok', `Anti-AFK ${e.target.checked ? 'on' : 'off'}`);
}));

function renderAfk() {
  const a = S.antiAfk; const c = S.settings.antiAfk;
  $('#afk-toggle').checked = a.enabled;
  const action = { space: 'press Space (jump)', wasd: 'tap W then S', rightclick: 'right-click (camera)', key: `press ${c.key}` }[c.action];
  $('#afk-info').innerHTML = !a.enabled ? '<span class="muted">Off – Roblox will kick idle clients after 20 minutes.</span>'
    : `Every <b>${c.intervalMin} min</b> each client gets one input (${esc(action)}); your active window and cursor are restored right after.
       <div style="margin-top:6px">${a.status ? `<span style="color:var(--warn)">${esc(a.status)}</span>` : a.nextDue ? `Next nudge in <b>${fmtIn(a.nextDue)}</b>` : '<span class="muted">No clients running.</span>'}${a.lastRun ? ` · last ${fmtAgo(a.lastRun)}` : ''}</div>`;
}

function renderWindows() {
  const u = S.launcher.unknown;
  $('#untracked').innerHTML = u.length ? `<div class="muted" style="margin-bottom:4px">Not started by the manager:</div>` + u.map((x) => `<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span class="mono">PID ${x.pid}</span><span class="muted">${x.memMB} MB</span><span class="spacer"></span><button class="btn sm" data-upid="${x.pid}">Close</button></div>`).join('') : '';
}
$('#untracked').addEventListener('click', (e) => {
  const b = e.target.closest('[data-upid]'); if (b) run(() => call('/ui/kill', { pids: [Number(b.dataset.upid)] }));
});

// ============================================================ launch target preview + favorites
let previewSeq = 0;
let lastPreview = null;
async function updatePreview() {
  const { input, jobId } = launchInput();
  store.set('lastInput', input); store.set('lastJob', jobId);
  const seq = ++previewSeq;
  const box = $('#preview');
  if (!input) { lastPreview = null; box.innerHTML = '<span class="muted small">Paste a game to preview it. Leave empty to rejoin each account\'s last game.</span>'; return; }
  box.innerHTML = '<span class="muted small">Looking up…</span>';
  try {
    const r = await call('/ui/game-info', { input, jobId });
    if (seq !== previewSeq) return;
    lastPreview = r;
    const kind = { game: 'Any server', job: 'Specific server', private: 'Private server', follow: 'Follow player' }[r.target.type];
    box.innerHTML = `${r.info?.icon ? `<img src="${esc(r.info.icon)}" alt="">` : `<div class="ph" style="width:42px;height:42px;border-radius:9px;background:var(--surface3)"></div>`}
      <div style="min-width:0"><div class="gn">${esc(r.info?.name || r.target.label)}</div>
      <div class="muted small">${kind}${r.info?.playing != null ? ` · ${fmtNum(r.info.playing)} playing` : ''}</div></div>`;
  } catch (e) {
    if (seq !== previewSeq) return;
    lastPreview = null;
    box.innerHTML = `<span class="err small">${esc(e.message)}</span>`;
  }
}
let pvTimer;
const schedulePreview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(updatePreview, 450); };
$('#launch-input').addEventListener('input', schedulePreview);
$('#launch-job').addEventListener('input', schedulePreview);
$('#launch-input').value = store.get('lastInput', '');
$('#launch-job').value = store.get('lastJob', '');
if ($('#launch-input').value) setTimeout(updatePreview, 300);

function setTarget(input, jobId = '') { $('#launch-input').value = input; $('#launch-job').value = jobId; updatePreview(); }

function renderFavs() {
  const favs = S.settings.favorites || [];
  $('#fav-count').textContent = favs.length || '';
  $('#favs').innerHTML = favs.length ? favs.map((f, i) => `<div class="fav" data-fav="${i}" title="${esc(f.input)}${f.jobId ? ' / ' + esc(f.jobId) : ''}">
      ${f.icon ? `<img src="${esc(f.icon)}" alt="">` : '<div class="ph"></div>'}<span class="fn">${esc(f.name || f.input)}</span>
      <button class="btn ghost icon sm" data-fav-launch="${i}" title="Launch selected here">${icon('play')}</button>
      <button class="btn ghost icon sm x" data-fav-del="${i}" title="Remove">${icon('x')}</button></div>`).join('')
    : '<span class="muted small">Save games and servers you use often with the ★ button.</span>';
}
$('#favs').addEventListener('click', (e) => run(async () => {
  const favs = S.settings.favorites || [];
  const del = e.target.closest('[data-fav-del]');
  if (del) { const list = favs.filter((_, i) => i !== Number(del.dataset.favDel)); return call('/ui/favorites', { list }); }
  const lb = e.target.closest('[data-fav-launch]');
  if (lb) { const f = favs[Number(lb.dataset.favLaunch)]; setTarget(f.input, f.jobId); return ACT.launch(needSel()); }
  const it = e.target.closest('[data-fav]');
  if (it) { const f = favs[Number(it.dataset.fav)]; setTarget(f.input, f.jobId); }
}));
bind($('#btn-fav-add'), async () => {
  const { input, jobId } = launchInput();
  if (!input) throw new Error('Enter a game first');
  const name = await promptDialog('Save favorite', { value: lastPreview?.info?.name || input, placeholder: 'Name' });
  if (name == null) return;
  const list = [...(S.settings.favorites || []), { name: name.trim() || input, input, jobId, icon: lastPreview?.info?.icon || '' }];
  await call('/ui/favorites', { list });
  toast('ok', 'Saved to favorites');
});

// ============================================================ add account
bind($('#btn-add'), async () => {
  const d = openDialog(`<h2>Add accounts</h2>
    <div class="chips" style="margin:10px 0 4px" id="add-tabs"><span class="chip on" data-t="login">Browser login</span><span class="chip" data-t="bulk">Bulk login</span><span class="chip" data-t="cookie">Import cookies</span></div>
    <div data-pane="login">
      <p class="lead">A clean, private browser window opens on roblox.com. Log in normally and solve any captcha or 2FA yourself; the session is captured the moment you're in and the window closes.</p>
      <div class="grid2"><div><label class="f">Username (optional)</label><input id="lg-user" autocomplete="off"></div>
      <div><label class="f">Password (optional)</label><input id="lg-pass" type="password" autocomplete="off"></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" id="lg-save"><span></span></label><div class="txt">Save password in the encrypted vault</div></div>
    </div>
    <div data-pane="bulk" class="hidden">
      <p class="lead">One <code>username:password</code> per line. Windows open one at a time with the details typed in, so you only solve captchas. Closing a window skips that account.</p>
      <textarea id="bl-lines" placeholder="user1:password1&#10;user2:password2"></textarea>
      <div class="toggle-row"><label class="switch"><input type="checkbox" id="bl-save" checked><span></span></label><div class="txt">Save passwords in the encrypted vault</div></div>
    </div>
    <div data-pane="cookie" class="hidden">
      <p class="lead">Paste one per line: raw <code>.ROBLOSECURITY</code> values, <code>user:pass:cookie</code>, or any text containing the cookie. Existing accounts are updated, never duplicated.</p>
      <textarea id="ck-text"></textarea>
      <div id="ck-res" class="small"></div>
    </div>
    <label class="f">Group</label><input id="add-group" placeholder="Default" list="group-list">
    <datalist id="group-list">${[...new Set(S.accounts.map((a) => a.group))].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="add-go">Open login window</button></div>`);
  let tab = 'login';
  $('#add-tabs', d).addEventListener('click', (e) => {
    const c = e.target.closest('[data-t]'); if (!c) return;
    tab = c.dataset.t;
    $$('#add-tabs .chip', d).forEach((x) => x.classList.toggle('on', x === c));
    $$('[data-pane]', d).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
    $('#add-go', d).textContent = { login: 'Open login window', bulk: 'Start bulk login', cookie: 'Import' }[tab];
  });
  bind($('#add-go', d), async () => {
    const group = $('#add-group', d).value.trim();
    if (tab === 'login') {
      await call('/ui/accounts/login', { username: $('#lg-user', d).value.trim(), password: $('#lg-pass', d).value, savePasswords: $('#lg-save', d).checked, group });
      closeDialog();
    } else if (tab === 'bulk') {
      const r = await call('/ui/accounts/login', { lines: $('#bl-lines', d).value, savePasswords: $('#bl-save', d).checked, group });
      toast('info', `Bulk login started for ${r.started} account(s)`); closeDialog();
    } else {
      const r = await call('/ui/accounts/import', { text: $('#ck-text', d).value, group });
      $('#ck-res', d).innerHTML = `<span class="okc">Added ${r.added}, updated ${r.updated}.</span>` + (r.failed.length ? `<div class="err">${r.failed.map(esc).join('<br>')}</div>` : '');
      if (!r.failed.length) setTimeout(closeDialog, 700);
    }
  });
});

// ============================================================ details
function openDetails(id) {
  const a = accById(id);
  if (!a) return;
  const fields = Object.entries(a.fields || {}).filter(([k]) => k !== 'antiAfk').map(([k, v]) => `${k}=${v}`).join('\n');
  const inst = instOf(id);
  const d = openDialog(`<div class="dialog-head">${a.avatarUrl ? `<img src="${esc(a.avatarUrl)}" alt="">` : '<img alt="">'}
      <div><h2>${esc(a.username)}</h2><div class="muted small">${esc(a.displayName)} · ${a.userId} · added ${new Date(a.addedAt).toLocaleDateString()}</div>
      <div style="margin-top:4px"><span class="badge ${esc(a.status)}">${esc(a.status)}</span> ${inst ? '<span class="badge running">running</span>' : ''} <span class="muted small">cookie ${a.cookieAgeDays}d old · last launch ${fmtAgo(a.lastUsedAt)}</span></div></div></div>
    ${a.statusMsg ? `<p class="err small">${esc(a.statusMsg)}</p>` : ''}
    <div class="grid2">
      <div><label class="f">Alias</label><input id="d-alias" value="${esc(a.alias)}" placeholder="Shown instead of username"></div>
      <div><label class="f">Group</label><input id="d-group" value="${esc(a.group)}"></div>
    </div>
    <label class="f">Description</label><input id="d-desc" value="${esc(a.description)}">
    <div class="grid2">
      <div><label class="f">Password ${a.hasPassword ? '(saved – blank keeps it)' : ''}</label><input id="d-pass" type="password" autocomplete="off"></div>
      <div><label class="f">Replace cookie</label><input id="d-cookie" autocomplete="off" placeholder="Paste a new .ROBLOSECURITY"></div>
    </div>
    <label class="f">Custom fields (key=value per line – readable from the API)</label><textarea id="d-fields" style="min-height:60px">${esc(fields)}</textarea>
    <div class="toggle-row"><label class="switch"><input type="checkbox" id="d-afk" ${a.fields?.antiAfk === 'off' ? '' : 'checked'}><span></span></label><div class="txt">Anti-AFK for this account</div></div>
    ${a.keepAlive.enabled ? `<div class="small">Keep-alive target: <b>${esc(a.keepAlive.target?.label)}</b></div>` : ''}
    <label class="f">History (this session)</label>
    <ol class="hist" id="d-history"><li><span class="ht muted">…</span><span class="muted">Loading</span></li></ol>
    <div class="btn-row">
      <button class="btn sm" id="d-browser">${icon('globe')}Browser</button>
      <button class="btn sm" id="d-validate">${icon('check')}Validate</button>
      <button class="btn sm" id="d-refresh" title="Get a fresh session cookie from Roblox">${icon('refresh')}Refresh cookie</button>
      <button class="btn sm" id="d-reveal">${icon('key')}Copy cookie</button>
      <button class="btn sm" id="d-relogin">${icon('lock')}Re-login</button>
      <button class="btn sm danger" id="d-logout" title="Revokes this cookie on Roblox">${icon('logout')}Sign out</button>
    </div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="d-save">Save</button></div>`);
  bind($('#d-save', d), async () => {
    const f = { antiAfk: $('#d-afk', d).checked ? 'on' : 'off' };
    for (const line of $('#d-fields', d).value.split('\n')) { const i = line.indexOf('='); if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    const patch = { alias: $('#d-alias', d).value.trim(), description: $('#d-desc', d).value.trim(), group: $('#d-group', d).value.trim() || 'Default', fields: f };
    if ($('#d-pass', d).value) patch.password = $('#d-pass', d).value;
    if ($('#d-cookie', d).value.trim()) patch.cookie = $('#d-cookie', d).value.trim();
    await call(`/ui/accounts/${id}/update`, patch);
    if (patch.cookie) await call('/ui/accounts/validate', { ids: [id] });
    toast('ok', 'Saved'); closeDialog();
  });
  loadHistory(d, id);
  bind($('#d-browser', d), async () => { await call(`/ui/accounts/${id}/browser`, {}); toast('ok', 'Browser opened'); });
  bind($('#d-validate', d), async () => { await ACT.validate([id]); closeDialog(); });
  bind($('#d-refresh', d), async () => { await call(`/ui/accounts/${id}/refresh-cookie`, {}); toast('ok', 'Cookie refreshed'); });
  bind($('#d-reveal', d), () => ACT.revealCookie(id));
  bind($('#d-relogin', d), async () => { await call('/ui/accounts/login', { username: a.username, password: '', group: a.group }); closeDialog(); });
  bind($('#d-logout', d), async () => {
    if (!await confirmDialog('Sign this session out?', 'The stored cookie is revoked on Roblox. You will need to log this account in again.', { ok: 'Sign out', danger: true })) return;
    await call(`/ui/accounts/${id}/logout`, {}); toast('ok', 'Signed out');
  });
}

const HIST_LABEL = { launch: 'Launch', join: 'Joined', disconnect: 'Disconnect', restart: 'Restart', verify: 'Verify', identity: 'Identity', breaker: 'Paused', guard: 'Guard' };
async function loadHistory(d, id) {
  const list = $('#d-history', d);
  if (!list) return;
  try {
    const rows = await call(`/ui/accounts/${id}/history`);
    if (!document.body.contains(d)) return;
    list.innerHTML = rows.length
      ? rows.map((h) => `<li><span class="ht">${new Date(h.t).toLocaleTimeString()}</span><span><span class="hk">${esc(HIST_LABEL[h.kind] || h.kind)}</span>${esc(h.msg)}</span></li>`).join('')
      : '<li><span class="ht muted">–</span><span class="muted">Nothing recorded yet this session.</span></li>';
  } catch (e) {
    list.innerHTML = `<li><span class="ht muted">–</span><span class="err">${esc(e.message)}</span></li>`;
  }
}

// ============================================================ unlock
$('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#unlock-err').textContent = '';
  try { await call('/ui/unlock', { password: $('#unlock-pw').value }); $('#unlock-pw').value = ''; } catch (err) { $('#unlock-err').textContent = err.message; }
});

// ============================================================ servers
let srvCursor = null;
let srvPlaceId = null;
function parsePlace(v) {
  const m = v.match(/games\/(\d+)/) || v.match(/placeId=(\d+)/i) || v.match(/^\s*(\d+)\s*$/);
  if (!m) throw new Error('Enter a place ID or game link');
  return Number(m[1]);
}
async function loadServers(more) {
  const placeId = more ? srvPlaceId : parsePlace($('#srv-place').value);
  srvPlaceId = placeId;
  const r = await call('/ui/servers', { placeId, cursor: more ? srvCursor : '', sortOrder: $('#srv-sort').value, excludeFull: $('#srv-hide-full').checked });
  srvCursor = r.next;
  if (r.info) {
    $('#srv-game').innerHTML = `<div class="srv-head">${r.info.icon ? `<img src="${esc(r.info.icon)}" alt="">` : ''}<div><div style="font-size:16px;font-weight:650">${esc(r.info.name || placeId)}</div>
      <div class="muted">${fmtNum(r.info.playing)} playing · max ${r.info.maxPlayers ?? '?'} per server · place ${placeId}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn sm" id="srv-use">Use as launch target</button><button class="btn sm" id="srv-fav">${icon('star')}Favorite</button></div></div></div>`;
    $('#srv-use').onclick = () => { setTarget(String(placeId)); showTab('accounts'); };
    $('#srv-fav').onclick = () => run(async () => { await call('/ui/favorites', { list: [...(S.settings.favorites || []), { name: r.info.name || String(placeId), input: String(placeId), jobId: '', icon: r.info.icon || '' }] }); toast('ok', 'Saved to favorites'); });
  }
  const rows = r.servers.map((s) => {
    const pct = Math.round((s.playing / s.maxPlayers) * 100);
    return `<tr><td><span class="pfill"><span style="width:${pct}%"></span></span>${s.playing}/${s.maxPlayers}</td><td>${s.ping ?? '—'} ms</td><td>${s.fps ? Math.round(s.fps) : '—'}</td>
      <td class="mono">${esc(s.id)}</td><td><div style="display:flex;gap:4px;justify-content:flex-end">
      <button class="btn primary sm" data-join="${esc(s.id)}">${icon('play')}Join selected</button>
      <button class="btn sm" data-use="${esc(s.id)}">Target</button><button class="btn sm icon" data-copy="${esc(s.id)}" title="Copy Job ID">${icon('copy')}</button></div></td></tr>`;
  }).join('');
  const tb = $('#srv-table tbody');
  if (more) tb.insertAdjacentHTML('beforeend', rows); else tb.innerHTML = rows || '<tr><td colspan="5"><div class="empty">No servers found.</div></td></tr>';
  $('#btn-srv-more').disabled = !srvCursor;
}
bind($('#btn-srv-load'), () => loadServers(false));
bind($('#btn-srv-more'), () => loadServers(true));
$('#srv-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(() => loadServers(false)); });
$('#srv-table').addEventListener('click', (e) => run(async () => {
  const j = e.target.closest('[data-join]'); const c = e.target.closest('[data-copy]'); const u = e.target.closest('[data-use]');
  if (j) { const ids = needSel(); await call('/ui/launch', { ids, target: { type: 'job', placeId: srvPlaceId, jobId: j.dataset.join, label: `${srvPlaceId} / ${j.dataset.join.slice(0, 8)}` } }); toast('info', `Joining with ${ids.length} account(s)`); }
  if (c) await ACT.copy(c.dataset.copy, 'Job ID');
  if (u) { setTarget(String(srvPlaceId), u.dataset.use); showTab('accounts'); }
}));
bind($('#btn-find-user'), async () => {
  const r = await call('/ui/find-user', { user: $('#find-user').value.trim() });
  const p = r.presence;
  const types = ['Offline', 'Online (website/app)', 'In game', 'In Studio', 'Invisible'];
  let html = `<b>${esc(r.user.name)}</b> — ${types[p?.userPresenceType ?? 0]}${p?.lastLocation ? ': ' + esc(p.lastLocation) : ''} `;
  if (p?.gameId && p.placeId) html += `<button class="btn primary sm" id="fu-join">Join their server</button>`;
  else if (p?.userPresenceType === 2) html += `<button class="btn sm" id="fu-follow">Try follow-join</button> <span class="muted">(server hidden by their privacy settings)</span>`;
  $('#find-result').innerHTML = html;
  $('#fu-join')?.addEventListener('click', () => run(() => call('/ui/launch', { ids: needSel(), target: { type: 'job', placeId: p.placeId, jobId: p.gameId, label: `${r.user.name}'s server` } })));
  $('#fu-follow')?.addEventListener('click', () => run(() => call('/ui/launch', { ids: needSel(), target: { type: 'follow', userId: r.user.id, label: `Follow ${r.user.name}` } })));
});
$('#find-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-find-user').click(); });

// ============================================================ settings
function openCaptchaTest() {
  const d = openDialog(`<h2>CAPTCHA simulator</h2>
    <p class="lead">Run a local picture-selection challenge with synthetic tiles. The simulator automatically picks a tile and tests a wrong selection too.</p>
    <div id="captcha-challenge"></div>
    <div id="captcha-result" class="small" role="status"></div>
    <div class="foot"><button type="button" class="btn" data-close>Close</button><button type="button" class="btn primary" id="captcha-run">Run simulation</button></div>`);
  bind($('#captcha-run', d), async () => {
    const challenge = $('#captcha-challenge', d);
    const result = $('#captcha-result', d);
    challenge.replaceChildren();
    result.className = 'small';
    result.textContent = 'Running simulation…';
    try {
      const r = await call('/ui/test/captcha', {});
      challenge.innerHTML = `<p>Find the ${esc(r.target)}.</p><ul class="captcha-tiles">${r.tiles.map((tile, i) =>
        `<li class="captcha-tile${i === r.selected ? ' selected' : ''}"><span aria-hidden="true">${esc(tile.symbol)}</span><span>${esc(tile.label)}${i === r.selected ? ' (selected)' : ''}</span></li>`
      ).join('')}</ul>`;
      result.textContent = `Automatic selection ${r.accepted ? 'accepted' : 'rejected'}. Wrong selection ${r.incorrectRejected ? 'rejected' : 'accepted'}.`;
      result.className = r.accepted && r.incorrectRejected ? 'small okc' : 'small err';
    } catch (e) {
      result.textContent = 'Simulation failed.';
      result.className = 'small err';
      throw e;
    }
  });
}

let settingsDirty = false;
const SETTINGS = [
  ['Launching', 'play', [
    ['multiInstance', 'bool', 'Multi-instance', 'Run many Roblox clients at once'],
    ['launchDelaySec', 'num', 'Delay between launches (seconds)', 'Roblox throttles rapid joins; 5–10 s is safest'],
    ['launchTimeoutSec', 'num', 'Wait for client to start (seconds)'],
    ['onAlreadyRunning', [['replace', 'Close the old client first'], ['skip', 'Skip that account'], ['allow', 'Allow a second client']], 'If an account is already running', 'Roblox kicks duplicate sessions, so "close old" is recommended'],
    ['robloxPath', 'text', 'Roblox executable', 'Leave blank to auto-detect (also works with Bloxstrap/Fishstrap)'],
    ['testClientPath', 'text', 'Test Roblox executable', 'Enter the full path to an older RobloxPlayerBeta.exe to use it for launches and retries. Roblox may still request an update. Clear this field to return to normal launching.'],
    ['neverUpdateRoblox', 'bool', "Don't update Roblox", 'Keeps your installed Roblox version: starts it directly and disables Roblox\'s own updater until you turn this off. Roblox may refuse to join games on an outdated version (error 280)'],
    ['presencePollSec', 'num', 'Live presence every (seconds)', 'Shows Online / In game for every account, also when it plays elsewhere. 0 turns it off'],
    ['skipUpdateCheck', 'bool', 'Skip update check when current', 'Starts the game directly if your installed Roblox is already the latest version. Falls back to the normal launcher (which updates) when it is not'],
  ]],
  ['Anti-AFK', 'zap', [
    ['antiAfk.enabled', 'bool', 'Anti-AFK', 'Prevents the 20-minute idle kick'],
    ['antiAfk.intervalMin', 'num', 'Nudge every (minutes)', '1–16. Clients are always nudged before the 20-minute mark'],
    ['antiAfk.action', [['space', 'Jump (Space)'], ['wasd', 'Step forward and back (W, S)'], ['rightclick', 'Right-click (camera, no movement)'], ['key', 'Custom key']], 'Input to send'],
    ['antiAfk.key', 'text', 'Custom key', 'A–Z, 0–9 or F1–F24 (only for "Custom key")'],
    ['antiAfk.waitUserIdleSec', 'num', 'Wait until you pause input (seconds)', 'Avoids stealing focus mid-typing; never delays more than 3 min'],
    ['antiAfk.includeUntracked', 'bool', 'Also nudge Roblox windows not started here'],
  ]],
  ['Captcha guard', 'lock', [
    ['captchaGuard.enabled', 'bool', 'Pause automation on a captcha', 'When Roblox shows a captcha or verification for any account, keep-alive rejoins, restarts, server hops and API launches stop until you resume'],
    ['captchaGuard.pauseAll', 'bool', 'Pause every account, not only the flagged one', 'Off = only the flagged account is stopped and everything else keeps running'],
    ['captchaGuard.autoResumeMin', 'num', 'Resume by itself after (minutes, 0 = never)', '0 waits for you to press Resume. Accounts still marked "needs verification" stay blocked until they are validated'],
  ]],
  ['Keep-alive watchdog', 'shield', [
    ['watchdog.enabled', 'bool', 'Watchdog enabled', 'Master switch for automatic relaunching'],
    ['watchdog.breakerDisconnects', 'num', 'Stop keep-alive after this many disconnects (0 = off)', 'Kicks and lost connections inside the window below turn keep-alive off for that account, so it stops rejoining and does not get asked to verify'],
    ['watchdog.breakerWindowMin', 'num', 'Disconnect window (minutes)'],
    ['watchdog.presenceCheck', 'bool', 'Presence fallback check', 'Also asks Roblox whether the account is in a game (catches clients stuck without any log signal)'],
    ['watchdog.disconnectGraceSec', 'num', 'Restart after disconnect (seconds)', 'Kicks and lost connections are read from the client log. Teleports reconnect within seconds and are ignored'],
    ['watchdog.presenceIntervalSec', 'num', 'Presence check interval (seconds)'],
    ['watchdog.graceSec', 'num', 'Grace period after launch (seconds)'],
    ['watchdog.badChecksToRestart', 'num', 'Failed checks before restart'],
    ['watchdog.relaunchDelaySec', 'num', 'Relaunch delay (seconds)', 'Wait before the first rejoin. Further rejoins within 30 minutes wait twice as long each time (up to 10 minutes), so Roblox asks for verification far less often'],
    ['watchdog.killHungAfterSec', 'num', 'Restart frozen clients after (seconds, 0 = never)'],
    ['watchdog.maxRelaunchesPerHour', 'num', 'Max relaunches per account per hour'],
    ['watchdog.fallbackToPublic', 'bool', 'Fall back to any server', 'If a saved server keeps failing, join any server of the game'],
    ['watchdog.restartEveryMin', 'num', 'Scheduled restart every (minutes, 0 = off)', 'Clears memory leaks in long sessions'],
  ]],
  ['Windows & performance', 'cpu', [
    ['renameWindows', 'bool', 'Name windows after the account'],
    ['windowTitle', 'text', 'Window title template', '{name} {username} {alias} {userId} {group}'],
    ['autoTile', 'bool', 'Auto-tile windows after each launch'],
    ['tileColumns', 'num', 'Tile columns (0 = auto)'],
    ['clientPriority', [['Normal', 'Normal'], ['BelowNormal', 'Below normal'], ['Idle', 'Low (idle)']], 'CPU priority of clients', 'Lower priority keeps your PC responsive with many alts'],
    ['trimMemoryMin', 'num', 'Trim client memory every (minutes, 0 = off)', 'Releases idle RAM back to Windows'],
    ['fastProfile', [['off', 'Off'], ['low', 'Low: lower texture quality'], ['lowest', 'Lowest: lowest textures, no post-processing']], 'Graphics preset', 'Written to every client on next launch. Custom FFlags below override it. Roblox ignores flags it does not allow'],
    ['fpsCap', 'num', 'FPS cap (0 = Roblox default)', 'Low caps (15–30) save lots of CPU/GPU on idle alts. Applies on next launch'],
    ['customFFlags', 'textarea', 'Extra FFlags (JSON)', 'Merged into ClientAppSettings.json. Roblox only honours allow-listed flags'],
  ]],
  ['Audio', 'sound', [
    ['muteMode', [['none', 'Don\'t change audio'], ['background', 'Only the focused client plays sound'], ['all', 'Mute all clients']], 'Client audio', 'Per-account overrides are in the right-click menu. Uses the Windows volume mixer'],
  ]],
  ['Discord alerts', 'bell', [
    ['alerts.webhook', 'text', 'Webhook URL', 'Server Settings → Integrations → Webhooks → Copy URL'],
    ['alerts.mention', 'text', 'Mention on errors', 'Optional, e.g. <@your user id>'],
    ['alerts.cooldownMin', 'num', 'Same alert at most every (minutes)'],
    ['alerts.events.crash', 'bool', 'Client crashed / closed'],
    ['alerts.events.disconnect', 'bool', 'Kicked / disconnected'],
    ['alerts.events.sameAccount', 'bool', 'Account signed in elsewhere'],
    ['alerts.events.invalid', 'bool', 'Login expired / account moderated'],
    ['alerts.events.throttled', 'bool', 'Relaunch limit reached'],
    ['alerts.events.launchFail', 'bool', 'Launch failed'],
    ['alerts.events.captchaGuard', 'bool', 'Captcha guard paused automation'],
  ]],
  ['General', 'gear', [
    ['startWithWindows', 'bool', 'Start with Windows', 'Starts hidden in the background; keep-alive accounts come back automatically after a reboot'],
    ['autoValidateOnStart', 'bool', 'Validate accounts on start'],
    ['openUiOnStart', 'bool', 'Open this window on start'],
    ['browserPath', 'text', 'Browser for logins', 'Leave blank for Edge, then Chrome'],
    ['port', 'num', 'Port (restart required)'],
  ]],
  ['Local API', 'server', [
    ['api.enabled', 'bool', 'Enable API', 'For your own scripts / macros on this PC'],
    ['api.password', 'password', 'API password', 'Leave blank to keep the current one'],
    ['api.allowCookieExport', 'bool', 'Allow /api/cookie', 'Dangerous: any program that knows the password can read cookies'],
  ]],
];
// Settings that can close clients, freeze Roblox or upset the display. Shown next to the setting.
// Only the ones the code actually acts on are listed; none of them is proven to be the cause of the main PC problem.
const RISK = {
  neverUpdateRoblox: 'Suspected cause: every 20 s it force-closes Roblox updater processes and renames updater files in Roblox version folders. Turn it off first if the PC keeps closing things.',
  multiInstance: 'Can cause strain: many clients at once use more GPU, RAM and CPU. Suspected of contributing on the main PC.',
  onAlreadyRunning: 'Can cause closes: "Close the old client first" force-closes the running client, and any executor attached to it closes with it.',
  clientPriority: 'Can cause freezes: a lower CPU priority can starve Roblox and any executor attached to it. Suspected of contributing.',
  trimMemoryMin: 'Can cause crashes: emptying a client memory can break injected executors and makes Roblox page memory back in. Suspected of contributing; keep at 0.',
  'antiAfk.enabled': 'Can take over input: it briefly focuses each Roblox window and sends a key or click. If focus slips, the input can land in another app. Suspected of contributing.',
  'antiAfk.action': 'Right-click and custom keys send input to the focused Roblox window. Suspected of contributing.',
  'antiAfk.includeUntracked': 'Also focuses Roblox windows the manager did not start. Suspected of contributing.',
  'watchdog.killHungAfterSec': 'Can cause closes: force-kills clients it thinks are frozen, which also closes any executor attached to them. Suspected of causing the close-outs.',
  'watchdog.restartEveryMin': 'Can cause closes: force-restarts clients on a timer, closing any executor attached to them. Suspected of contributing.',
  fastProfile: 'Can cause display problems: changes Roblox render and GPU settings. Suspected of contributing to the monitor blinking; try Off.',
  fpsCap: 'Changes Roblox frame limits. Suspected of contributing to display problems; try 0.',
  customFFlags: 'Can cause crashes or display problems: every flag you add changes Roblox behavior directly. Suspected of contributing; leave empty.',
};
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach((k) => { x = x[k] = x[k] || {}; }); x[ks.at(-1)] = v; };

function renderSettings() {
  if (!S) return;
  const st = S.settings;
  const field = ([key, type, label, hint]) => {
    const v = getPath(st, key);
    const h = hint ? `<div class="hint">${esc(hint)}</div>` : '';
    const r = RISK[key] ? `<div class="risk">${esc(RISK[key])}</div>` : '';
    if (type === 'bool') return `<div class="toggle-row"><label class="switch"><input type="checkbox" name="${key}" ${v ? 'checked' : ''}><span></span></label><div class="txt">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>${r}`;
    let input;
    if (Array.isArray(type)) input = `<select name="${key}">${type.map(([val, txt]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea name="${key}" style="min-height:70px">${esc(v)}</textarea>`;
    else if (type === 'password') input = `<input type="password" name="${key}" placeholder="${st.api.passwordSet ? '•••••••• (set)' : 'not set'}" autocomplete="new-password">`;
    else input = `<input name="${key}" type="${type === 'num' ? 'number' : 'text'}" value="${esc(v)}">`;
    return `<label class="f">${esc(label)}</label>${input}${h}${r}`;
  };
  $('#settings-form').innerHTML = `<div class="settings-grid">${SETTINGS.map(([title, ic, items]) => `<div class="card"><h3>${icon(ic)}${esc(title)}</h3>${items.map(field).join('')}</div>`).join('')}
    <div class="card"><h3>${icon('lock')}Vault security</h3>
      <p class="small muted" style="margin-top:0">${S.vaultMode === 'scrypt' ? 'Protected by your master password (AES-256-GCM + scrypt). You unlock it on every start.' : 'Protected by Windows DPAPI (AES-256-GCM key tied to your Windows user). Opens automatically.'}</p>
      ${S.vaultMode === 'scrypt' ? '<label class="f">Current master password</label><input type="password" id="mp-current">' : ''}
      <label class="f">New master password</label><input type="password" id="mp-new" placeholder="${S.vaultMode === 'scrypt' ? 'Blank = remove (use Windows DPAPI)' : 'At least 6 characters'}">
      <div class="btn-row"><button class="btn" type="button" id="btn-mp">${S.vaultMode === 'scrypt' ? 'Change / remove password' : 'Set master password'}</button></div>
    </div>
    <div class="card"><h3>${icon('power')}App</h3>
      <p class="small muted" style="margin-top:0">"Start Manager.vbs" (or the desktop shortcut) runs the manager without a console window. Quitting never closes your Roblox clients; multi-instance stays protected until they are all closed.</p>
      <div class="btn-row"><button class="btn" type="button" id="btn-shortcut">Create desktop shortcut</button><button class="btn" type="button" id="btn-test-alert">${icon('bell')}Send test alert</button><button class="btn" type="button" id="btn-captcha-test">CAPTCHA simulator</button></div>
    </div>
    <div class="card"><h3>${icon('server')}API reference</h3><div class="small muted">Base: <span class="mono">${esc(S.apiUrl)}</span><br>
      <span class="mono">accounts</span> · <span class="mono">status</span> · <span class="mono">launch?account=NAME&placeId=ID[&jobId=]</span> · <span class="mono">kill?account=</span> · <span class="mono">keepalive?account=&placeId=&enabled=true</span> · <span class="mono">field?account=&key=[&value=]</span> · <span class="mono">cookie?account=</span><br>
      Send the password as header <span class="mono">X-Api-Password</span> or <span class="mono">?password=</span>.</div>
      <div class="small" style="margin-top:8px">Roblox: <span class="mono">${S.roblox ? esc(S.roblox.path) : 'not found'}</span><br>Login browser: ${S.browserFound ? 'found' : '<span class="err">not found</span>'}</div></div>
  </div>
  <div class="save-bar"><button class="btn primary" type="submit" id="settings-save">Save settings</button><span class="muted small" id="settings-state"></span></div>`;
  settingsDirty = false;
  bind($('#btn-mp'), changeMasterPassword);
  bind($('#btn-captcha-test'), openCaptchaTest);
  bind($('#btn-shortcut'), async () => { await call('/ui/shortcut', {}); toast('ok', 'Shortcut "Roblox Account Manager" added to your desktop'); });
  bind($('#btn-test-alert'), async () => {
    if (settingsDirty) throw new Error('Save settings first');
    await call('/ui/alerts/test', {}); toast('ok', 'Test alert sent - check your Discord channel');
  });
}
$('#settings-form').addEventListener('input', () => { settingsDirty = true; const s = $('#settings-state'); if (s) s.textContent = 'Unsaved changes'; });
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => {
    const patch = {};
    for (const [, , items] of SETTINGS) for (const [key, type] of items) {
      const el = $(`[name="${key}"]`, e.target);
      if (!el) continue;
      setPath(patch, key, type === 'bool' ? el.checked : type === 'num' ? Number(el.value) : el.value);
    }
    await call('/ui/settings', patch);
    settingsDirty = false;
    toast('ok', 'Settings saved');
    renderSettings();
  });
});
async function changeMasterPassword() {
  const pw = $('#mp-new').value;
  if (pw && pw.length < 6) throw new Error('Use at least 6 characters');
  if (pw) {
    const again = await promptDialog('Confirm master password', { type: 'password', ok: 'Confirm', hint: 'Type it again. If you forget it, the vault cannot be recovered.' });
    if (again === null) return;
    if (again !== pw) throw new Error('Passwords did not match');
  }
  const r = await call('/ui/security/master-password', { current: $('#mp-current')?.value || '', password: pw });
  toast('ok', `Vault now protected by ${r.mode === 'scrypt' ? 'your master password' : 'Windows DPAPI'}`);
  renderSettings();
}

// ============================================================ logs
let logLevel = '';
$('#log-search').addEventListener('input', () => renderLogs());
$('#log-chips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-lvl]'); if (!c) return;
  logLevel = c.dataset.lvl;
  $$('#log-chips .chip').forEach((x) => x.classList.toggle('on', x === c));
  renderLogs();
});
function renderLogs() {
  const q = ($('#log-search').value || '').trim().toLowerCase();
  const ok = (l) => (!logLevel || (logLevel === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error'))
    && (!q || l.msg.toLowerCase().includes(q) || l.scope.toLowerCase().includes(q));
  const view = $('#log-view');
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
  view.innerHTML = logs.filter(ok).slice(-1000).map((l) => `<span class="lv-t">${new Date(l.t).toLocaleTimeString()}</span> <span class="lv-s">${esc(l.scope)}</span> <span class="lv-${l.level}">${esc(l.msg)}</span>`).join('\n') || '<span class="muted">Nothing yet.</span>';
  if (atBottom) view.scrollTop = view.scrollHeight;
}

// ============================================================ keyboard
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select, button, a, [contenteditable]');
  if (e.key === 'Escape') {
    if ($('#menu')) return closeMenu();
    if ($('#dialog')) return closeDialog();
    if (!typing && selected.size) { selected.clear(); selectionChanged(); }
    return;
  }
  if (!$('#tab-accounts').classList.contains('active') || $('#dialog')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#filter').focus(); return; }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); visibleAccounts().forEach((a) => selected.add(a.id)); selectionChanged(); }
  else if (e.key === 'Delete' && selected.size) run(() => ACT.del(selIds()));
  else if (e.key === 'Enter' && selected.size) run(() => ACT.launch(selIds()));
});
