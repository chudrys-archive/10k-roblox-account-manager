'use strict';
/* 10k's Account Manager – UI. Vanilla JS; all state comes from the local service over SSE. */

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
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  flask: '<path d="M9 3h6M10 3v6L4.6 18.2A1.6 1.6 0 0 0 6 20.6h12a1.6 1.6 0 0 0 1.4-2.4L14 9V3"/><path d="M7.5 15h9"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
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
  const leave = () => { if (el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 170); };
  el.addEventListener('click', leave);
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 5) $('#toasts').firstChild.remove();
  setTimeout(leave, type === 'error' ? 12000 : 5000);
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
function closeDialog() {
  const d = $('#dialog');
  if (!d) return;
  d.id = 'dialog-closing';
  d.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
  d.classList.add('closing');
  setTimeout(() => d.remove(), 150);
}

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
  store.set('tab.v2', name);
  if (name === 'clients' && S && !S.locked) { renderHealth(); renderFleet(); }
  if (name === 'logs') { errCount = 0; renderNav(); renderLogs(); }
  if (name === 'settings') { renderSettings(true); refreshBackups().catch(() => {}); }
  if (name === 'experiments') { renderExperiments(); const ap = $('#audit-path'); if (ap && !ap.value && S && S.settings.executor) ap.value = S.settings.executor.scriptsPath || ''; }
  placeNavInd();
}
$$('.nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
const navInd = document.createElement('i');
navInd.className = 'nav-ind';
$('.nav').appendChild(navInd);
let navIndPlaced = false;
function placeNavInd() {
  const b = $('.nav button.active');
  if (!b) return;
  if (!navIndPlaced) { navInd.style.transition = 'none'; }
  const horizontal = getComputedStyle($('.nav')).flexDirection === 'row';
  if (horizontal) { navInd.style.width = b.offsetWidth + 'px'; navInd.style.height = ''; navInd.style.transform = `translateX(${b.offsetLeft}px)`; }
  else { navInd.style.height = b.offsetHeight + 'px'; navInd.style.width = ''; navInd.style.transform = `translateY(${b.offsetTop}px)`; }
  if (!navIndPlaced) { navIndPlaced = true; requestAnimationFrame(() => requestAnimationFrame(() => { navInd.style.transition = ''; })); }
}
new ResizeObserver(placeNavInd).observe($('.nav'));
window.addEventListener('resize', placeNavInd);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeNavInd);
showTab(store.get('tab.v2', 'clients'));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) { showTab(g.dataset.goto); return; }
  if (e.target.closest('[data-goto-add]')) $('#btn-add').click();
});

// ============================================================ live connection
// When the manager goes away the page keeps showing the last state it received. Say so loudly, and find out why.
let connLostTimer = null;
function setConnLost(lost) {
  let b = document.getElementById('conn-banner');
  if (!lost) {
    clearInterval(connLostTimer); connLostTimer = null;
    if (b) b.remove();
    return;
  }
  if (!b) { b = document.createElement('div'); b.id = 'conn-banner'; b.className = 'conn-banner'; document.body.prepend(b); }
  b.textContent = 'Lost connection to the manager. Everything below is old data.';
  if (connLostTimer) return;
  connLostTimer = setInterval(async () => {
    const bar = document.getElementById('conn-banner');
    try {
      const r = await fetch('/ui/state', { cache: 'no-store' });
      if (r.ok) { location.reload(); return; }
      if (bar) bar.textContent = r.status === 401
        ? 'The manager was restarted and this window can no longer talk to it. Close this window and open the manager again. Everything below is old data.'
        : 'The manager answered with an error. Everything below is old data.';
    } catch { if (bar) bar.textContent = 'The manager is not running. Everything below is old data.'; }
  }, 3000);
}
function connect() {
  const es = new EventSource('/ui/events');
  es.addEventListener('state', (e) => { S = JSON.parse(e.data); render(); });
  es.addEventListener('log', (e) => {
    const l = JSON.parse(e.data);
    logs.push(l); if (logs.length > 2000) logs.shift();
    if (l.level === 'error' && store.get('tab.v2') !== 'logs') { errCount++; renderNav(); }
    if ($('#tab-logs').classList.contains('active')) renderLogs();
  });
  es.addEventListener('toast', (e) => { const t = JSON.parse(e.data); toast(t.type, t.msg); });
  es.onopen = () => { $('#side-status')?.classList.remove('err'); setConnLost(false); };
  es.onerror = () => { $('#side-status').innerHTML = '<div class="row bad"><span class="dot err"></span>Disconnected – is the manager running?</div>'; setConnLost(true); };
}
call('/ui/logs').then((l) => logs.push(...l)).catch(() => {});
connect();
setInterval(() => { if (S && !S.locked && !document.hidden) { renderStats(); renderAfk(); renderHealth(); renderFleet(); } }, 1000);
setInterval(() => { if (S && !S.locked && !document.hidden) renderTable(); }, 10000);

function render() {
  $('#lock').classList.toggle('hidden', !S.locked);
  if (S.locked) { $('#unlock-pw').focus(); return; }
  for (const id of [...selected]) if (!accById(id)) selected.delete(id);
  renderNav();
  renderSide();
  renderStats();
  renderHealth();
  renderFleet();
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
  $('#nav-run').textContent = S.launcher.instances.length || '';
  $('#nav-err').textContent = errCount ? `${errCount}` : '';
  $('#nav-err').style.color = errCount ? 'var(--err)' : '';
}

function renderSide() {
  const rows = [];
  const m = S.launcher.multi;
  if (!S.roblox) rows.push('<div class="row bad"><span class="dot err"></span>Roblox not found</div>');
  if (S.settings.multiInstance && m && m.mutex !== 'held' && m.wanted) rows.push('<div class="row bad" title="A Roblox client started outside the manager owns the lock. Close all Roblox windows once."><span class="dot warn"></span>Multi-client lock not held</div>');
  rows.push(`<div class="conn"><span class="dot ok"></span>Connected${S.update && S.update.current ? ` \u00b7 v${esc(S.update.current)}` : ''}</div>`);
  $('#side-status').innerHTML = rows.join('');
}

// Skip innerHTML when the markup did not change, so rows keep hover, focus and selection across the 1 s / 10 s refresh.
// Newer release notice (the manager only tells you; download and install are yours). Dismissed per version.
function renderUpdate() {
  const el = $('#update-banner');
  const u = S && S.update;
  const dismissed = !!(u && localStorage.getItem('updateDismissed') === u.latest);
  const show = !!(u && u.available && !dismissed);
  el.classList.toggle('hidden', !show);
  if (!show) { el.innerHTML = ''; return; }
  const sig = u.latest + '|' + u.url;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = `<span><b>Version ${esc(u.latest)} is out</b> (you have ${esc(u.current)}).</span>
    <a href="${esc(u.url || 'https://github.com/chudrys-archive/10k-roblox-account-manager/releases/latest')}" target="_blank" rel="noopener">Open the release</a>
    <span class="spacer"></span>
    <button class="btn ghost sm" data-update-dismiss>Dismiss</button>`;
}
$('#update-banner').addEventListener('click', (e) => {
  if (e.target.closest('[data-update-dismiss]') && S && S.update) { localStorage.setItem('updateDismissed', S.update.latest); renderUpdate(); }
});
const htmlCache = new Map();
function setHtml(sel, html) {
  if (htmlCache.get(sel) === html) return;
  htmlCache.set(sel, html);
  document.querySelector(sel).innerHTML = html;
}

function renderStats() {
  const acc = S.accounts;
  const valid = acc.filter((a) => a.status === 'valid').length;
  const bad = acc.filter((a) => a.status === 'invalid').length;
  const banned = acc.filter((a) => a.status === 'banned').length;
  const verify = acc.filter((a) => a.status === 'verify').length;
  const inst = S.launcher.instances;
  const mem = inst.reduce((s, i) => s + (i.memMB || 0), 0);
  const ka = acc.filter((a) => a.keepAlive.enabled);
  const kaIssues = ka.filter((a) => ['error', 'throttled', 'waiting'].includes(S.watchdog[a.id]?.status)).length;
  const robux = acc.reduce((s, a) => s + (a.robux || 0), 0);
  const afk = S.antiAfk;
  const afkVal = !afk.enabled ? 'Off' : afk.nextDue ? fmtIn(afk.nextDue) : 'Idle';
  const afkHint = !afk.enabled ? 'idle kick after 20 min' : afk.status || (afk.nextDue ? 'until next nudge' : 'no clients running');
  const cards = [
    ['users', 'Accounts', acc.length, `${valid} valid${bad ? ` · <span class="err">${bad} need login</span>` : ''}${banned ? ` \u00b7 <span class="err">${banned} banned</span>` : ''}${verify ? ` · <span class="err">${verify} need verification</span>` : ''}`],
    ['play', 'Running', inst.length, inst.length ? `${(mem / 1024).toFixed(1)} GB RAM · queue ${S.launcher.queued.length}` : `queue ${S.launcher.queued.length}`],
    ['shield', 'Keep-alive', ka.length, kaIssues ? `<span style="color:var(--warn)">${kaIssues} recovering</span>` : 'all healthy'],
    ['zap', 'Anti-AFK', afkVal, esc(afkHint)],
    ...(S.executor && S.executor.enabled ? [['window', S.executor.name.replace(/\.exe$/i, ''), ({ running: 'Open', starting: 'Starting', waiting: 'Restarting', held: 'Closed', closed: 'Closed', standby: 'Standby', throttled: 'Paused', error: 'Problem' })[S.executor.status] || S.executor.status, esc(S.executor.status === 'running' ? `${S.executor.memMB} MB` : S.executor.msg)]] : []),
    ['hex', 'Robux', fmtNum(robux), 'across all accounts'],
    ['cpu', 'Untracked', S.launcher.unknown.length, 'not started here'],
  ];
  const t = `${inst.length ? `(${inst.length}) ` : ''}10k's Account Manager`;
  if (document.title !== t) document.title = t;
  renderQueueBanner();
  renderUpdate();
  $('#btn-check-ban').disabled = (S.browsers || []).some((b) => b.kind === 'login');
  setHtml('#stats', cards.map(([ic, l, v, h]) => `<div class="stat"><div class="label">${icon(ic)}${l}</div><div class="val">${v}</div><div class="hint">${h}</div></div>`).join(''));
}

// ============================================================ clients (live fleet)
const STATE_CLASS = { ok: 'ok', launching: 'warn', degraded: 'warn', failed: 'err' };
const WATCH_CLASS = { error: 'err', throttled: 'err', waiting: 'warn', stopped: 'muted' };
const fmtGB = (mb) => (mb == null ? '\u2014' : `${(mb / 1024).toFixed(2)} GB`);
function fmtHours(h) {
  if (h == null) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} days`;
}
// Autoscaled to the data, but never tighter than 10% of the top value, so ordinary jitter stays flat.
function spark(values, trend) {
  if (!values || values.length < 2) return '<span class="muted small">\u2014</span>';
  const w = 96; const h = 22;
  const lo = Math.min(...values); const hi = Math.max(...values);
  const span = Math.max(hi - lo, hi * 0.1, 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${esc(trend || '')}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="memory history, ${Math.round(lo)} to ${Math.round(hi)} MB"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderHealth() {
  const f = S.launcher.fleet || {};
  const g = S.captchaGuard || {};
  const wd = S.settings.watchdog.enabled;
  const cell = (cls, label, value, hint, title = '') => `<div class="hcell ${cls}" title="${esc(title)}"><div class="hl">${label}</div><div class="hv">${value}</div><div class="hh">${hint}</div></div>`;
  const lvl = { ok: 'ok', watch: 'warn', danger: 'err' }[f.level] || '';
  const free = f.freeGB;
  const stale = f.memoryAt && Date.now() - f.memoryAt > 60000;
  const rate = f.meanMBPerMin;
  const trend = f.trend || { id: 'unknown', label: 'measuring' };
  const hrs = fmtHours(f.hoursToLimit);
  const hoursCls = f.hoursToLimit == null ? '' : f.hoursToLimit < 2 ? 'err' : f.hoursToLimit < 6 ? 'warn' : 'ok';
  const ka = S.accounts.filter((a) => a.keepAlive.enabled).length;
  const kaBad = S.accounts.filter((a) => a.keepAlive.enabled && ['error', 'throttled', 'waiting'].includes(S.watchdog[a.id]?.status)).length;
  const multi = S.settings.multiInstance && S.launcher.multi && S.launcher.multi.wanted ? S.launcher.multi : null;
  const exe = S.executor && S.executor.enabled ? S.executor : null;
  const cells = [
    cell(S.runs && S.runs.build && S.runs.build.changed ? 'warn' : '', 'Clients', f.clients || 0, `queue ${S.launcher.queued.length}${S.launcher.unknown.length ? ` \u00b7 ${S.launcher.unknown.length} not started here` : ''}${S.runs && S.runs.exits ? ` \u00b7 ${S.runs.exits} unplanned exit${S.runs.exits === 1 ? '' : 's'} in 24 h` : ''}`,
      S.runs && S.runs.build && S.runs.build.changed ? `Roblox build changed from ${S.runs.build.previous} to ${S.runs.build.current}. Memory baselines from earlier runs may not apply.` : (S.runs && S.runs.build && S.runs.build.current ? `Roblox build ${S.runs.build.current}` : '')),
    cell(free == null ? '' : lvl, 'Free commit', free == null ? '\u2014' : `${free.toFixed(1)} GB`,
      free == null ? 'no reading yet' : `${f.limitGB ? `of ${f.limitGB.toFixed(0)} GB` : 'limit unknown'}${stale ? ' (stale)' : ''}${f.room != null ? ` \u00b7 room for ${f.room} more` : ''}`,
      'Colour thresholds are defaults, not measured limits: amber under 40 GB free or under 6 h to the limit, red under 20 GB or under 2 h. Room for N more follows the launch gate: it plans at least 8 GB per client (clients grow over hours) and keeps 6 GB back.'),
    cell(S.runs && S.runs.last ? 'warn' : 'ok', 'Last crash', S.runs && S.runs.last ? esc(fmtAgo(S.runs.last.at)) : 'None', S.runs && S.runs.last ? esc(S.runs.last.username || 'client') + ' \u00b7 ' + esc(S.runs.last.reason) : 'no unplanned exits in 24 h', 'The newest client that ended without the manager closing it, within the last 24 hours.'),
    cell('', 'Client memory', `${(f.totalPrivGB || 0).toFixed(1)} GB`, `private memory${f.cpuPct != null && f.clients ? ` \u00b7 CPU ${f.cpuPct.toFixed(0)}% of PC` : ', all clients'}`),
    cell(trend.id === 'climbing' ? 'err' : trend.id === 'flat' ? 'ok' : '', 'Growth', rate == null ? 'measuring' : `${rate >= 0 ? '+' : ''}${rate.toFixed(0)} MB/min`,
      rate == null ? 'needs 5+ min of history' : `${esc(trend.label)} per client${f.gbPerHour != null && f.gbPerHour >= 0.1 ? ` \u00b7 ~${f.gbPerHour.toFixed(1)} GB/h total` : ''}`,
      'Average slope per client over the last 15 minutes, ignoring each client\'s first 5 minutes.'),
    cell(hoursCls, 'Time to limit', hrs || (f.gbPerHour == null ? 'measuring' : 'no growth'), `until ${f.keepFreeGB || 15} GB free`,
      'A projection from the last 15 minutes of growth, not a promise. It assumes the rate stays the same.'),
    g.paused
      ? cell('err', 'Automation', 'Paused', '<button class="btn sm" id="fleet-resume">Resume</button> captcha guard')
      : cell(!wd || kaBad ? 'warn' : 'ok', 'Automation', wd ? 'Watchdog on' : 'Watchdog paused', `${ka} keep-alive account${ka === 1 ? '' : 's'}${kaBad ? ` \u00b7 ${kaBad} recovering` : ''}`, 'Keep-alive brings back an account whose client closed, crashed or was kicked. Accounts that keep failing back off and are paused after too many tries.'),
    ...(multi ? [cell(multi.mutex === 'held' ? 'ok' : 'err', 'Multi-instance', multi.mutex === 'held' ? 'Active' : 'Needs fix',
      multi.mutex === 'held' ? 'clients run side by side' : `<button class="btn sm" id="fleet-multi">Fix now</button> ${esc(multi.mutex === 'lock holder not running' ? 'lock holder not running' : 'a client owns the lock')}`,
      "The manager holds Roblox's single-instance lock so several clients can run at once. Fix now frees the lock inside running clients without closing them and restarts the lock holder if it stopped.")] : []),
    ...(exe ? [(() => {
      const st = exe.status;
      const cls = st === 'running' ? 'ok' : (st === 'error' || st === 'throttled') ? 'err' : (st === 'closed' || st === 'standby' || st === 'waiting' || st === 'starting') ? 'warn' : '';
      const val = ({ running: 'Open', starting: 'Starting', waiting: 'Restarting', held: 'Held', closed: 'Closed', standby: 'Not open', throttled: 'Paused', error: 'Problem' })[st] || st;
      const canOpen = exe.pathKnown && (st === 'closed' || st === 'standby' || st === 'error');
      const hint = st === 'running' ? `${exe.memMB} MB${exe.hook && exe.hook.configured ? ' \u00b7 attach file set' : ''}` : `${canOpen ? '<button class="btn sm" id="fleet-exec">Open now</button> ' : ''}${esc(exe.msg || '')}`;
      return cell(cls, esc(exe.name.replace(/\.exe$/i, '')), val, hint, 'Your script executor. It is opened before clients launch and again if it closes while they run.');
    })()] : []),
  ];
  setHtml('#health', cells.join(''));
  setHtml('#preflight', (S.preflight || []).map((p) => `<div class="pf ${p.level}"><span class="dot ${p.level === 'error' ? 'err' : p.level === 'warn' ? 'warn' : ''}"></span>${esc(p.text)}</div>`).join(''));
}

function cpuCell(i) {
  if (i.cpuPct == null) return '<td class="num"><span class="muted">measuring</span></td>';
  const capped = i.capped ? ` <span class="cap-tag" title="Held to ${i.capped}% of the whole PC by the CPU cap in Settings">cap ${i.capped}%</span>` : '';
  return `<td class="num">${i.cpuPct.toFixed(1)}%${capped}</td>`;
}

function errCell(er) {
  return '<td class="ev err-text" title="' + esc(er ? er.msg : '') + '">' + (er ? esc(fmtAgo(er.t)) + ' \u00b7 ' + esc(er.msg) : '<span class="muted">none</span>') + '</td>';
}

function renderFleet() {
  const now = Date.now();
  const rows = [];
  const running = new Set();
  const nm = (id) => { const a = accById(id); return a ? nameOf(a) : String(id); };
  const insts = [...S.launcher.instances].sort((a, b) => nm(a.accountId).localeCompare(nm(b.accountId)));
  for (const i of insts) {
    running.add(i.accountId);
    const g = i.growth || {};
    const ev = S.lastEvents && S.lastEvents[i.accountId];
    const er = S.lastErrors && S.lastErrors[i.accountId];
    const cls = STATE_CLASS[i.state] || '';
    const rate = g.mbPerMin == null ? '<span class="muted">measuring</span>' : `${g.mbPerMin >= 0 ? '+' : ''}${g.mbPerMin.toFixed(0)} MB/min`;
    rows.push(`<tr data-acc="${esc(i.accountId)}"><td><b>${esc(nm(i.accountId))}</b></td>` +
      `<td><span class="st ${cls}"><span class="dot ${cls}"></span>${esc(i.stateLabel || i.state || '')}</span></td>` +
      `<td class="num">${fmtDur(now - i.startedAt)}</td><td class="num">${fmtGB(i.privMB)}</td>` +
      cpuCell(i) +
      `<td class="num">${rate}${g.trend && g.trend !== 'unknown' ? ` <span class="muted small">${esc(g.trendLabel)}</span>` : ''}</td>` +
      `<td>${spark(g.spark, g.trend)}</td>` +
      `<td class="ev" title="${esc(ev ? ev.msg : '')}">${ev ? `${esc(fmtAgo(ev.t))} \u00b7 ${esc(ev.msg)}` : '<span class="muted">\u2014</span>'}</td>` + errCell(er) + '</tr>');
  }
  for (const a of S.accounts) {
    if (!a.keepAlive.enabled || running.has(a.id)) continue;
    const ws = S.watchdog[a.id] && S.watchdog[a.id].status;
    const cls = WATCH_CLASS[ws] || 'warn';
    const ev = S.lastEvents && S.lastEvents[a.id];
    const er = S.lastErrors && S.lastErrors[a.id];
    rows.push(`<tr data-acc="${esc(a.id)}"><td><b>${esc(nameOf(a))}</b></td>` +
      `<td><span class="st ${cls}"><span class="dot ${cls}"></span>${esc(ws ? `keep-alive: ${ws}` : 'waiting to relaunch')}</span></td>` +
      `<td class="num muted">\u2014</td><td class="num muted">\u2014</td><td class="num muted">\u2014</td><td class="num muted">\u2014</td><td></td>` +
      `<td class="ev" title="${esc(ev ? ev.msg : '')}">${ev ? `${esc(fmtAgo(ev.t))} \u00b7 ${esc(ev.msg)}` : '<span class="muted">\u2014</span>'}</td>` + errCell(er) + '</tr>');
  }
  setHtml('#fleet-body', rows.join(''));
  $('#fleet-empty').classList.toggle('hidden', rows.length > 0);
  setHtml('#fleet-sub', insts.length ? ` \u00b7 ${insts.length} running` : '');
}
$('#fleet-body').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-acc]');
  if (tr) openDetails(tr.dataset.acc);
});
$('#health').addEventListener('click', (e) => {
  if (e.target.closest('#fleet-resume')) run(() => call('/ui/captcha-guard/resume', {}));
  if (e.target.closest('#fleet-multi')) run(async () => { await call('/ui/multi', {}); toast('ok', 'Checked the multi-client lock'); });
  if (e.target.closest('#fleet-exec')) run(async () => { await call('/ui/executor/open', {}); toast('ok', 'Opening the executor'); });
});
$('#fleet-tile').addEventListener('click', () => $('#btn-tile').click());
$('#fleet-snap').addEventListener('click', async () => {
  try {
    const r = await call('/ui/snapshot', {});
    const box = $('#fleet-snapout');
    const rows = r.snapshot.rows;
    if (!rows.length) { box.classList.remove('hidden'); box.textContent = 'No running clients to snapshot.'; return; }
    const d = new Map(r.diff.map((x) => [x.pid, x]));
    const num = (v, dp = 0) => (v == null ? '' : Number(v).toFixed(dp));
    const cell = (v, dv, unit) => esc(num(v)) + (dv != null ? ' <span class="muted">(' + (dv >= 0 ? '+' : '') + num(dv, 1) + unit + '/min)</span>' : '');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="muted" style="margin-bottom:6px">Snapshot ' + new Date(r.snapshot.at).toLocaleTimeString() + (r.previousAt ? ', change since ' + new Date(r.previousAt).toLocaleTimeString() : ', take another one in a few minutes to see change per minute') + '</div><table class="fleet-table"><thead><tr><th>Account</th><th>Private MB</th><th>Working set MB</th><th>Handles</th><th>GDI</th><th>USER</th><th>Threads</th><th>Paged pool KB</th></tr></thead><tbody>' +
      rows.map((x) => { const y = d.get(x.pid) || {}; return '<tr><td>' + esc(r.names[x.pid] || x.pid) + '</td><td>' + cell(x.privateMB, y.privateMBPerMin, '') + '</td><td>' + cell(x.workingSetMB, y.workingSetMBPerMin, '') + '</td><td>' + cell(x.handles, y.handlesPerMin, '') + '</td><td>' + cell(x.gdi, y.gdiPerMin, '') + '</td><td>' + cell(x.user, y.userPerMin, '') + '</td><td>' + cell(x.threads, y.threadsPerMin, '') + '</td><td>' + cell(x.pagedPoolKB, y.pagedPoolKBPerMin, '') + '</td></tr>'; }).join('') + '</tbody></table>';
  } catch (e) { toast('error', e.message); }
});
$('#fleet-map').addEventListener('click', async () => {
  const btn = $('#fleet-map');
  btn.disabled = true;
  try {
    const r = await call('/ui/vmmap', {});
    const box = $('#fleet-snapout');
    const rows = r.map.rows;
    box.classList.remove('hidden');
    if (!rows.length) { box.textContent = 'No running clients to map.'; return; }
    const d = new Map(r.diff.map((x) => [x.pid, x]));
    const cell = (v, dv) => esc(Number(v).toFixed(1)) + (dv != null ? ' <span class="muted">(' + (dv >= 0 ? '+' : '') + Number(dv).toFixed(1) + '/min)</span>' : '');
    box.innerHTML = '<div class="muted" style="margin-bottom:6px">Memory map ' + new Date(r.map.at).toLocaleTimeString() + (r.previousAt ? ', change since ' + new Date(r.previousAt).toLocaleTimeString() : ', take another one in a few minutes to see change per minute') + '. Values in MB. Private memory is split by protection; heap, stack and managed memory are not told apart.</div><table class="fleet-table"><thead><tr><th>Account</th><th>Private</th><th>Read/write</th><th>Exec + write</th><th>Read-only / exec</th><th>Image</th><th>Mapped</th><th>Reserved</th><th>Regions</th><th>Largest private block</th></tr></thead><tbody>' +
      rows.map((x) => { const y = d.get(x.pid) || {}; return x.error
        ? '<tr><td>' + esc(r.names[x.pid] || x.pid) + '</td><td colspan="9" class="muted">' + esc(x.error) + ' (the client may run as administrator)</td></tr>'
        : '<tr><td>' + esc(r.names[x.pid] || x.pid) + '</td><td>' + cell(x.privateMB, y.privateMBPerMin) + '</td><td>' + cell(x.readWriteMB, y.readWriteMBPerMin) + '</td><td>' + cell(x.execWriteMB, y.execWriteMBPerMin) + '</td><td>' + cell(x.readOnlyMB, y.readOnlyMBPerMin) + '</td><td>' + cell(x.imageMB, y.imageMBPerMin) + '</td><td>' + cell(x.mappedMB, y.mappedMBPerMin) + '</td><td>' + cell(x.reservedMB, y.reservedMBPerMin) + '</td><td>' + esc(x.regions) + '</td><td>' + cell(x.largestPrivateMB, y.largestPrivateMBPerMin) + '</td></tr>'; }).join('') + '</tbody></table>';
  } catch (e) { toast('error', e.message); } finally { btn.disabled = false; }
});
$('#fleet-close').addEventListener('click', () => $('#btn-kill-all').click());

// ============================================================ accounts table
function renderChips() {
  const groups = [...new Set(S.accounts.map((a) => a.group))].sort();
  if (groupFilter && !groups.includes(groupFilter)) groupFilter = '';
  $('#group-chips').innerHTML = groups.length > 1
    ? [`<span class="chip ${!groupFilter ? 'on' : ''}" data-g="">All</span>`, ...groups.map((g) => `<span class="chip ${g === groupFilter ? 'on' : ''}" data-g="${esc(g)}">${esc(g)} <span class="muted">${S.accounts.filter((a) => a.group === g).length}</span></span>`)].join('')
    : '';
}
$('#group-chips').addEventListener('contextmenu', (e) => {
  const c = e.target.closest('[data-g]');
  if (!c || !c.dataset.g) return;
  e.preventDefault();
  const g = c.dataset.g;
  const members = S.accounts.filter((a) => a.group === g);
  const usable = members.filter((a) => a.status === 'valid').map((a) => a.id);
  const running = members.filter((a) => instOf(a.id)).map((a) => a.id);
  const kaOn = usable.length > 0 && usable.every((id) => accById(id).keepAlive.enabled);
  const items = [{ header: g + ' \u00b7 ' + members.length + ' account' + (members.length === 1 ? '' : 's') },
    { icon: 'play', label: 'Launch group (' + usable.length + ' valid)', fn: () => (usable.length ? ACT.launch(usable) : toast('info', 'No valid accounts in this group')) },
    ...(running.length ? [{ icon: 'stop', label: 'Stop group (' + running.length + ' running)', fn: () => ACT.stop(running) }] : []),
    { icon: 'shield', label: kaOn ? 'Keep-alive off for group' : 'Keep-alive on for group', fn: () => (usable.length ? ACT.keepAlive(usable, !kaOn) : toast('info', 'No valid accounts in this group')) },
    { icon: 'check', label: 'Select group', fn: () => { members.filter((a) => !a.main).forEach((a) => selected.add(a.id)); selectionChanged(); } },
  ];
  openMenu(e.clientX, e.clientY, items);
});
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
  const label = { running: 'healthy', idle: 'standby', launching: 'launching', waiting: 'recovering', stopped: 'stopped', throttled: 'throttled', error: 'error', paused: 'paused' }[st] || st;
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
        <div style="min-width:0"><div class="nm">${esc(nameOf(a))}${a.main ? ' <span class="main-tag" title="Your Main account: left out of select-all, Close all and scheduled restarts">MAIN</span>' : ''}${a.perf ? ' <span class="perf-tag" title="Has its own FPS / graphics / window size">custom perf</span>' : ''}</div><div class="meta">${esc(a.alias ? a.username : a.displayName)} · ${a.userId}${a.description ? ' · ' + esc(a.description) : ''}</div></div></div></td>
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
  setHtml('#acc-table tbody', rows || (S.accounts.length
    ? '<tr><td colspan="8"><div class="empty">No accounts match this filter.</div></td></tr>'
    : `<tr><td colspan="8"><div class="welcome"><img class="logo" src="/logo.svg" alt=""><h2>Welcome to 10k's Account Manager</h2><p>Run several Roblox accounts side by side and keep them online. Three steps to get going:</p><ol class="steps"><li><span class="n">1</span><div><b>Add an account</b><span>Log in through a browser window, or import a cookie.</span></div></li><li><span class="n">2</span><div><b>Pick a game</b><span>Paste a place ID or game link into the Launch box on the right.</span></div></li><li><span class="n">3</span><div><b>Launch</b><span>Select your accounts and press Launch. Turn on keep-alive to rejoin automatically.</span></div></li></ol><button class="btn primary" type="button" data-goto-add>${icon('plus')}Add your first account</button></div></td></tr>`));
  const pickable = list.filter((a) => !a.main);
  $('#sel-all').checked = pickable.length > 0 && pickable.every((a) => selected.has(a.id));
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
  const vis = visibleAccounts().filter((a) => !a.main).map((a) => a.id);
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

function renderQueueBanner() {
  const qn = S.launcher.queued.length;
  let qb = document.getElementById('queue-banner');
  if (!qn) { if (qb) qb.remove(); return; }
  if (!qb) { qb = document.createElement('div'); qb.id = 'queue-banner'; qb.className = 'queue-banner'; $('#stats').before(qb); }
  qb.innerHTML = `<span><span class="dot"></span>${qn} launch${qn === 1 ? '' : 'es'} waiting, started one at a time</span><button class="btn sm" id="cancel-queue">Cancel queued</button>`;
  bind(qb.querySelector('#cancel-queue'), () => ACT.cancelQueue(null));
}

// ============================================================ actions
const ACT = {
  async launch(ids) {
    const { input, jobId } = launchInput();
    const r = await call('/ui/launch', { ids, input, jobId, sameServer: $('#same-server').checked });
    toast('info', `Launching ${r.queued} → ${r.target.label}`);
  },
  async cancelQueue(ids) {
    const r = await call('/ui/launch/cancel', ids ? { ids } : { all: true });
    toast(r.cancelled ? 'ok' : 'info', r.cancelled ? `Cancelled ${r.cancelled} queued launch${r.cancelled === 1 ? '' : 'es'}` : 'Nothing was waiting to launch');
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
    ...(ids.some((id) => S.launcher.queued.includes(id)) ? [{ icon: 'stop', label: 'Cancel queued launch', fn: () => ACT.cancelQueue(ids) }] : []),
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
      { icon: 'star', label: one.main ? 'Unmark as Main account' : 'Mark as Main account', fn: () => call(`/ui/accounts/${one.id}/update`, { main: !one.main }).then(() => toast('ok', one.main ? `${nameOf(one)} is a normal account again` : `${nameOf(one)} is your Main account`)) },
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
bind($('#btn-check-ban'), async () => {
  const r = await call('/ui/accounts/check-login', {});
  if (r && r.busy) toast('info', 'A check or login window is already open. Finish or close it first.');
});
bind($('#btn-signup'), async () => {
  const r = await call('/ui/accounts/signup', {});
  if (r && r.busy) toast('info', 'A check or login window is already open. Finish or close it first.');
});
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
  bind($('#btn-trim'), async () => { const r = await call('/ui/trim', {}); toast('ok', r.queued ? `Freeing idle RAM on ${r.queued} client(s), one at a time` : 'No clients are running'); });
bind($('#btn-kill-all'), async () => {
  const ka = S.accounts.filter((a) => a.keepAlive.enabled).length;
  const keptMain = S.settings.closeAllKeepsMain === false ? [] : S.accounts.filter((a) => a.main && instOf(a.id)).map(nameOf);
  if (!await confirmDialog('Close every Roblox client?', `Clients are closed one by one, 10-15 seconds apart. Includes windows not started by the manager.${keptMain.length ? ` ${keptMain.join(', ')} stays open (Main account).` : ''}${ka ? ` ${ka} keep-alive account(s) will be relaunched unless you turn keep-alive off first.` : ''}`, { ok: 'Close all', danger: true })) return;
  const r = await call('/ui/kill', { all: true }); toast('ok', r.already ? 'Already closing clients one by one' : `Closing ${r.closing} client(s) one by one, 10-15 s apart`);
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
  document.body.innerHTML = '<div class="lock"><div class="card" style="text-align:center;width:360px"><img class="logo" src="/logo.svg" alt="" style="margin:0 auto 14px"><h2 style="margin:0 0 6px">Manager stopped</h2><p class="muted">Start it again with the desktop shortcut or "Start Manager.vbs". You can close this window.</p></div></div>';
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
    <div class="chips" style="margin:10px 0 4px" id="add-tabs"><span class="chip on" data-t="login">Browser login</span><span class="chip" data-t="bulk">Bulk login</span><span class="chip" data-t="quick">Quick login</span><span class="chip" data-t="cookie">Import cookies</span></div>
    <div data-pane="login">
      <p class="lead">A clean, private sign-in window opens on roblox.com. Log in normally and solve any captcha or 2FA yourself; the session is captured the moment you're in and the window closes.</p>
      <div class="grid2"><div><label class="f">Username (optional)</label><input id="lg-user" autocomplete="off"></div>
      <div><label class="f">Password (optional)</label><input id="lg-pass" type="password" autocomplete="off"></div></div>
      <div class="toggle-row"><label class="switch"><input type="checkbox" id="lg-save"><span></span></label><div class="txt">Save password in the encrypted vault</div></div>
    </div>
    <div data-pane="bulk" class="hidden">
      <p class="lead">One <code>username:password</code> per line. Windows open one at a time with the details typed in, so you only solve captchas. Closing a window skips that account.</p>
      <textarea id="bl-lines" placeholder="user1:password1&#10;user2:password2"></textarea>
      <div class="toggle-row"><label class="switch"><input type="checkbox" id="bl-save" checked><span></span></label><div class="txt">Save passwords in the encrypted vault</div></div>
    </div>
    <div data-pane="quick" class="hidden">
      <p class="lead">The sign-in window opens on the Roblox login page with the QR code already showing. Scan it with a phone that is already signed into the account and approve the request; the account is added automatically.</p>
      <div style="text-align:center"><img id="qr-img" alt="" style="width:220px;height:220px;background:#fff;padding:8px;border-radius:8px"></div>
      <div id="qr-status" class="small" style="text-align:center"></div>
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
    $('#add-go', d).textContent = { login: 'Open login window', bulk: 'Start bulk login', quick: 'Show QR code', cookie: 'Import' }[tab];
  });
  bind($('#add-go', d), async () => {
    const group = $('#add-group', d).value.trim();
    if (tab === 'login') {
      const r = await call('/ui/accounts/login', { username: $('#lg-user', d).value.trim(), password: $('#lg-pass', d).value, savePasswords: $('#lg-save', d).checked, group });
      if (r && r.busy) { toast('info', 'A login window is already open. Finish or close it first.'); return; }
      closeDialog();
    } else if (tab === 'bulk') {
      const r = await call('/ui/accounts/login', { lines: $('#bl-lines', d).value, savePasswords: $('#bl-save', d).checked, group });
      if (r && r.busy) { toast('info', 'A login window is already open. Finish or close it first.'); return; }
      toast('info', `Bulk login started for ${r.started} account(s)`); closeDialog();
    } else if (tab === 'quick') {
      const r = await call('/ui/accounts/quick-login', { group });
      if (r && r.busy) { toast('info', 'A login window is already open. Finish or close it first.'); return; }
      $('#add-go', d).disabled = true;
      $('#qr-status', d).textContent = 'Waiting for you to approve the code on your phone...';
      let waiting = true; // the manager is waiting for this login until it is captured, cancelled or times out
      const stop = () => { if (waiting) { waiting = false; call('/ui/accounts/login/cancel', {}).catch(() => {}); } };
      $('[data-close]', d).addEventListener('click', stop);
      const iv = setInterval(async () => {
        if (!document.body.contains(d)) { clearInterval(iv); stop(); return; }
        const q = await call('/ui/accounts/quick-login/state', {});
        if (q && q.src) $('#qr-img', d).src = q.src;
        if (q && !q.armed) { waiting = false; clearInterval(iv); closeDialog(); }
      }, 2000);
    } else {
      const r = await call('/ui/accounts/import', { text: $('#ck-text', d).value, group });
      $('#ck-res', d).innerHTML = `<span class="okc">Added ${r.added}, updated ${r.updated}.</span>` + (r.failed.length ? `<div class="err">${r.failed.map(esc).join('<br>')}</div>` : '');
      if (!r.failed.length) setTimeout(closeDialog, 700);
    }
  });
});

// ============================================================ details
function perfOpts(opts, cur) {
  const c = String(cur);
  const all = opts.some(([v]) => String(v) === c) ? opts : [...opts, [cur, c]];
  return all.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === c ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

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
    <div class="toggle-row"><label class="switch"><input type="checkbox" id="d-main" ${a.main ? 'checked' : ''}><span></span></label><div class="txt">Main account<small>The one you play yourself. Left out of select-all, Close all and scheduled restarts.</small></div></div>
    <label class="f">Performance for this account<span class="muted"> (overrides the global settings; applies on its next launch)</span></label>
    <div class="grid3">
      <div><div class="sub-f">FPS cap</div><select id="d-fps">${perfOpts([[0, 'Global'], [15, '15'], [20, '20'], [30, '30'], [45, '45'], [60, '60'], [120, '120'], [240, '240']], (a.perf && a.perf.fpsCap) || 0)}</select></div>
      <div><div class="sub-f">Graphics quality</div><select id="d-gfx">${perfOpts([[0, 'Global'], [1, '1 (lowest)'], [2, '2'], [3, '3'], [5, '5'], [8, '8'], [10, '10']], (a.perf && a.perf.graphicsLevel) || 0)}</select></div>
      <div><div class="sub-f">Window size</div><select id="d-win">${perfOpts([['0x0', 'Global'], ['160x120', '160 x 120'], ['240x180', '240 x 180'], ['320x240', '320 x 240'], ['480x270', '480 x 270'], ['640x360', '640 x 360'], ['800x600', '800 x 600']], a.perf && a.perf.windowWidth ? a.perf.windowWidth + 'x' + a.perf.windowHeight : '0x0')}</select></div>
    </div>
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
    const [pw, ph] = $('#d-win', d).value.split('x').map(Number);
    const patch = { alias: $('#d-alias', d).value.trim(), description: $('#d-desc', d).value.trim(), group: $('#d-group', d).value.trim() || 'Default', fields: f,
      main: $('#d-main', d).checked, perf: { fpsCap: Number($('#d-fps', d).value), graphicsLevel: Number($('#d-gfx', d).value), windowWidth: pw || 0, windowHeight: ph || 0 } };
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
  bind($('#d-relogin', d), async () => {
  const r = await call('/ui/accounts/login', { username: a.username, password: '', group: a.group });
  if (r && r.busy) { toast('info', 'A login window is already open. Finish or close it first.'); return; }
  closeDialog();
});
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
let settingsSig = '';
const SETTINGS = [
  ['Launching', 'play', [
    ['launchDelaySec', 'num', 'Delay between launches (seconds)', 'Roblox throttles rapid joins; 5–10 s is safest'],
  ['signInGapSec', 'num', 'Gap between sign-ins (seconds)', 'A new client starts signing in only after the previous one started this long ago. Longer gaps mean Roblox challenges accounts far less often'],
    ['launchTimeoutSec', 'num', 'Wait for client to start (seconds)'],
    ['multiInstance', 'bool', 'Allow more than one Roblox client', 'Run several Roblox clients side by side by holding Roblox\'s single-instance lock. If clients close unexpectedly, turn this off.'],
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
    ['watchdog.startOnEnable', 'bool', 'Also start accounts that are not open', 'Off (recommended): keep-alive only relaunches a client that was open and then closed or crashed. On: it also launches keep-alive accounts by itself, for example after a reboot'],
    ['watchdog.resumeAfterRestart', 'bool', 'Bring accounts back after a restart', 'If the PC restarts or the manager crashes while keep-alive accounts are running, they are launched again one at a time. Accounts you closed yourself stay closed, and a list older than 12 hours is ignored'],
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
    ['trimMemoryMin', 'num', 'Trim client memory every (minutes, 0.5 = 30 s, 0 = off)', 'Releases idle RAM back to Windows, one client at a time and spread evenly over the interval. It lowers RAM only, not commit'],
  ['trimWhenFreeBelowPct', 'num', 'Only trim while free RAM is below (% of total, 100 = always)', 'Trimming makes each client page its memory back in, which costs CPU. With plenty of free RAM that work is not needed, so trimming waits until free RAM drops under this level. Clients that have not regrown since their last trim are skipped too'],
    ['cpuCapPct', 'num', 'CPU cap per background client (0 = off)', 'Windows enforces it: each client may use at most this share of the whole PC. Idle clients barely notice; busy ones slow down instead of starving the rest'],
    ['closeAllKeepsMain', 'bool', 'Close all leaves my Main account running', 'Applies to the Close all button, its hotkey, the run-window end and scheduled restarts. Mark an account as Main in its right-click menu'],
    ['cpuCapSpareFront', 'bool', 'Never cap the client in front or one still loading', 'Keeps the window you are playing smooth and lets new clients finish joining quickly'],
    ['graphicsApi', [['auto', 'Automatic (Roblox decides)'], ['d3d11', 'Direct3D 11'], ['vulkan', 'Vulkan'], ['opengl', 'OpenGL']], 'Graphics API', 'Applied on next launch through an allow-listed flag. The client log shows which API a client actually used: check the Clients page. Vulkan and OpenGL can crash or glitch on some GPUs'],
    ['minimizedAction', [['leave', 'Leave minimized'], ['park', 'Move off-screen instead']], 'When a client is minimized', 'Minimized Roblox windows can use more memory over time on some setups. Off-screen keeps the window restored instead. Use an experiment to see which is better on your PC'],
    ['schedule.enabled', 'bool', 'Run window for automatic launches', 'Keep-alive only launches inside the window. Clients already running are left alone unless the option below is on'],
    ['schedule.start', 'text', 'Window starts (HH:MM, local time)'],
    ['schedule.end', 'text', 'Window ends (HH:MM, local time). Past midnight is fine'],
    ['schedule.days', 'text', 'Days (1 = Monday ... 7 = Sunday, e.g. 12345)'],
    ['schedule.closeAtEnd', 'bool', 'Close clients when the window ends', 'Staggered, 10-15 seconds apart, same as Close all'],
    ['dryRun', 'bool', 'Dry run (launch nothing)', 'Launch buttons, keep-alive and experiments only write what they would do to Activity. Turn off to launch for real'],
    ['noPowerThrottle', 'bool', 'Keep clients out of efficiency mode', 'Asks Windows not to slow background or minimized clients (EcoQoS). Applies to running clients within a few seconds. Use an experiment to see whether it helps on your PC'],
    ['fastProfile', [['off', 'Off'], ['low', 'Low: lower texture quality'], ['lowest', 'Lowest: lowest textures, no post-processing']], 'Graphics preset', 'Written to every client on next launch. Custom FFlags below override it. Roblox ignores flags it does not allow'],
    ['fpsCap', 'num', 'FPS cap (0 = Roblox default)', 'Low caps (15–30) save lots of CPU/GPU on idle alts. Applies on next launch'],
    ['graphicsLevel', 'num', 'Graphics quality (0 = Automatic)', '1 is the lowest. Applies on next launch'],
    ['windowWidth', 'num', 'Client window width', 'Roblox will not go below 800\u00d7600 by itself. The manager shrinks every client to this size a few seconds after it opens, and leaves a maximized window alone. 0 = Roblox default'],
    ['windowHeight', 'num', 'Client window height', 'Set both width and height, or neither'],
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
    ['alerts.events.executor', 'bool', 'Executor closed and did not come back', 'Sent when the executor stays closed for 90 seconds while clients are running'],
    ['alerts.events.memory', 'bool', 'Free memory is low', 'Sent when the Clients page health turns red (under 20 GB free, or under 2 hours to the limit). Thresholds are defaults, not measured limits'],
    ['alerts.quiet.enabled', 'bool', 'Quiet hours', 'Holds back everything except errors during the window below'],
    ['alerts.quiet.start', 'text', 'Quiet from (HH:MM, local time)'],
    ['alerts.quiet.end', 'text', 'Quiet until (HH:MM, local time)'],
  ]],
  ['Executor', 'cpu', [
    ['executor.enabled', 'bool', 'Watch the executor', 'Keeps track of the executor program that runs next to your clients. It never touches a Roblox client'],
    ['executor.path', 'text', 'Executor location', 'Pick one above, or paste the path to its .exe. It is filled in by itself when the manager can read it from the running program'],
    ['executor.relaunch', 'bool', 'Open it again if it closes', 'Only after it was open. While this is on, closing it yourself opens it again'],
    ['executor.startWithManager', 'bool', 'Open it with the manager', 'Starts it when the manager starts, if it is not already open'],
    ['executor.asAdmin', 'bool', 'Needs administrator rights', 'Opens it with Run as administrator, so Windows asks for permission each time. This is detected by itself for an executor that is already open as administrator; turn it on if it only works that way'],
    ['executor.openBeforeClients', 'bool', 'Open it before clients launch', 'Many executors only attach to clients that start after them. When it is not open, it is opened first and the launch waits for it'],
    ['executor.openWaitSec', 'num', 'Wait for it to open'],
    ['executor.afterLaunch.command', 'text', 'Run a file after each client launches', 'Optional: a .exe, .bat, .cmd or .ps1 file, for example your own re-attach script. It gets the variables IRAM_PID, IRAM_PIDS, IRAM_ACCOUNT, IRAM_USERID and IRAM_EXECUTOR'],
    ['executor.afterLaunch.args', 'text', 'Arguments for that file'],
    ['executor.afterLaunch.delaySec', 'num', 'Wait before running it'],
    ['executor.afterLaunch.rerunOnRestart', 'bool', 'Run it again when the executor comes back', 'If the executor closes and opens again while clients are running, your file runs again for each running client, one after another. A restarted executor does not know the clients that were already open'],
  ]],
  ['Tray and hotkeys', 'monitor', [
    ['tray.enabled', 'bool', 'Tray icon', 'Right-click the icon for Open, Close all clients and Quit. Quitting from the tray never closes your Roblox clients'],
    ['tray.hotkeyOpen', 'text', 'Hotkey: open the manager', 'Optional, for example Ctrl+Alt+M. Needs Ctrl, Alt or Win plus a letter, digit or F1-F24'],
    ['tray.hotkeyCloseAll', 'text', 'Hotkey: close all clients', 'Optional, for example Ctrl+Alt+Q. Closes every client one at a time, with no confirmation'],
  ]],
  ['General', 'gear', [
    ['startWithWindows', 'bool', 'Start with Windows', 'Starts hidden in the background. With "Bring accounts back after a restart" on, keep-alive accounts that were running come back one at a time after a reboot'],
    ['autoValidateOnStart', 'bool', 'Validate accounts on start'],
    ['validateEveryHours', 'num', 'Re-check logins automatically (hours, 0 = off)', 'Finds expired cookies before a launch fails. A Discord alert goes out for each account that needs a new login (turn that alert on below)'],
    ['openUiOnStart', 'bool', 'Open this window on start'],
    ['windowMode', 'text', 'Manager window'],
    ['loginWindow', 'text', 'Sign-in window'],
    ['browserPath', 'text', 'Browser', 'Used to open an account in a browser, and for sign-in when it is set to Browser. Leave blank for Edge, then Chrome'],
    ['port', 'num', 'Port (restart required)'],
  ]],
  ['Local API', 'server', [
    ['api.enabled', 'bool', 'Enable API', 'For your own scripts / macros on this PC'],
    ['api.password', 'password', 'API password', 'Leave blank to keep the current one'],
    ['api.allowCookieExport', 'bool', 'Allow /api/cookie', 'Dangerous: any program that knows the password can read cookies'],
  ]],
];
// Typed numbers become option groups, times and days get real pickers, hotkeys are recorded instead of typed.
const pk = (vals, fmt, zero) => ({ num: true, seg: vals.map((v) => [v, v === 0 && zero ? zero : fmt(v)]) });
const fmtSec = (v) => (v >= 120 && v % 60 === 0 ? `${v / 60} min` : `${v} s`);
const fmtMin = (v) => (v < 1 ? `${Math.round(v * 60)} s` : v >= 120 && v % 60 === 0 ? `${v / 60} h` : `${v} min`);
const fmtPlain = (v) => String(v);
const PICKERS = {
  'executor.openWaitSec': [pk([0, 5, 10, 15, 30, 60], fmtSec, 'Do not wait'), 'Wait for it to open', 'How long a launch waits for the executor after opening it'],
  'executor.afterLaunch.delaySec': [pk([0, 5, 10, 20, 30, 60, 120], fmtSec, 'Right away'), 'Wait before running it', 'Gives the client time to open before your file runs'],
  windowMode: [{ seg: [['app', 'Built-in window'], ['browser', 'Browser window']] }, 'Manager window', 'The built-in window needs no Chrome or Edge and applies the next time the window opens'],
  loginWindow: [{ seg: [['app', 'Built-in window'], ['browser', 'Chrome or Edge']] }, 'Sign-in window', 'Add account, quick login and checks sign in inside the manager with a throwaway profile, so no browser or extension is needed. Chrome or Edge uses your own browser profile with the capture extension'],
  launchDelaySec: [pk([3, 5, 6, 8, 10, 15, 20, 30], fmtSec), 'Delay between launches'],
  signInGapSec: [pk([30, 60, 90, 120, 180, 240, 300], fmtSec), 'Gap between sign-ins'],
  launchTimeoutSec: [pk([30, 60, 90, 120, 180], fmtSec), 'Wait for a client to start'],
  presencePollSec: [pk([0, 15, 30, 60, 120, 300], fmtSec, 'Off'), 'Live presence refresh'],
  'antiAfk.intervalMin': [pk([5, 8, 10, 12, 14, 15], fmtMin), 'Nudge every', 'Clients are always nudged before the 20-minute mark'],
  'antiAfk.waitUserIdleSec': [pk([0, 2, 4, 8, 15], fmtSec, 'Right away'), 'Wait until you pause input'],
  'captchaGuard.autoResumeMin': [pk([0, 5, 15, 30, 60, 120], fmtMin, 'Never'), 'Resume by itself after', '"Never" waits for you to press Resume. Accounts still marked "needs verification" stay blocked until they are validated'],
  'watchdog.breakerDisconnects': [pk([0, 2, 3, 4, 6, 10], fmtPlain, 'Off'), 'Stop keep-alive after this many disconnects'],
  'watchdog.breakerWindowMin': [pk([10, 20, 30, 60, 120], fmtMin), 'Disconnect window'],
  'watchdog.disconnectGraceSec': [pk([10, 15, 25, 45, 90], fmtSec), 'Restart after a disconnect'],
  'watchdog.presenceIntervalSec': [pk([20, 30, 45, 90, 180], fmtSec), 'Presence check interval'],
  'watchdog.graceSec': [pk([30, 60, 120, 150, 240, 300], fmtSec), 'Grace period after launch'],
  'watchdog.badChecksToRestart': [pk([1, 2, 3, 4, 5], fmtPlain), 'Failed checks before a restart'],
  'watchdog.relaunchDelaySec': [pk([0, 5, 15, 30, 60, 120], fmtSec, 'None'), 'Delay before relaunching'],
  'watchdog.killHungAfterSec': [pk([0, 60, 120, 300, 600], fmtSec, 'Never'), 'Restart frozen clients after'],
  'watchdog.maxRelaunchesPerHour': [pk([3, 5, 10, 15, 30, 60], fmtPlain), 'Most relaunches per account per hour'],
  'watchdog.restartEveryMin': [pk([0, 30, 60, 120, 240, 360, 720], fmtMin, 'Off'), 'Scheduled restart every'],
  tileColumns: [pk([0, 1, 2, 3, 4, 5, 6], fmtPlain, 'Auto'), 'Tile columns'],
  trimMemoryMin: [pk([0, 0.5, 1, 2, 5, 15, 30, 60], fmtMin, 'Off'), 'Trim client memory every'],
  trimWhenFreeBelowPct: [pk([25, 35, 50, 70, 100], (v) => (v >= 100 ? 'always' : v + '%')), 'Only trim while free RAM is below'],
  fpsCap: [pk([0, 15, 20, 30, 45, 60, 120], fmtPlain, 'Roblox default'), 'FPS cap'],
  validateEveryHours: [pk([0, 6, 12, 24], (v) => v + ' h', 'Off'), 'Re-check logins every'],
  cpuCapPct: [pk([0, 3, 5, 8, 12, 20], (v) => v + '%', 'Off'), 'CPU cap per background client', 'Share of the whole PC. 5% is a good start for AFK alts; the cap is lifted while a client loads'],
  graphicsLevel: [pk([0, 1, 2, 3, 5, 8, 10], fmtPlain, 'Automatic'), 'Graphics quality'],
  windowWidth: [pk([0, 160, 240, 320, 480, 640, 800], fmtPlain, 'Default'), 'Client window width'],
  windowHeight: [pk([0, 120, 180, 240, 270, 360, 600], fmtPlain, 'Default'), 'Client window height'],
  'alerts.cooldownMin': [pk([1, 5, 10, 15, 30, 60], fmtMin), 'Same alert at most every'],
  'schedule.start': ['time', 'Window starts'],
  'schedule.end': ['time', 'Window ends', 'Past midnight is fine'],
  'schedule.days': ['days', 'Days it runs', 'Tap a day to turn it on or off'],
  'alerts.quiet.start': ['time', 'Quiet from'],
  'alerts.quiet.end': ['time', 'Quiet until'],
  'tray.hotkeyOpen': ['hotkey'],
  'tray.hotkeyCloseAll': ['hotkey'],
  'antiAfk.key': ['afkkey', 'Custom key', 'Only used when the input above is "Custom key"'],
  windowTitle: [{ tpl: [['{name}', 'Account name'], ['{username}', 'Username'], ['{alias}', 'Alias'], ['{userId}', 'User ID'], ['{group}', 'Group']] }, 'Window title', 'Tap the pieces to add them, or type your own text'],
  'alerts.mention': [{ tpl: [['@here', '@here'], ['@everyone', '@everyone']], replace: true }, 'Mention on errors', 'Optional. Pick one, or paste a user mention such as <@123456789>'],
};
for (const [, , items] of SETTINGS) for (const it of items) {
  const p = PICKERS[it[0]];
  if (!p) continue;
  it[1] = p[0];
  if (p[1]) it[2] = p[1];
  if (p[2] !== undefined) it[3] = p[2];
}
const DAY_NAMES = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']];
const AFK_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Array.from({ length: 12 }, (_, i) => 'F' + (i + 1))];
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach((k) => { x = x[k] = x[k] || {}; }); x[ks.at(-1)] = v; };

/** Tell the person when Windows refused a hotkey (usually another program already owns it). */
function paintTrayStatus() {
  const t = S.tray; if (!t) return;
  const notes = { open: ['tray.hotkeyOpen', 'open the manager'], closeAll: ['tray.hotkeyCloseAll', 'close all clients'] };
  for (const [k, [name]] of Object.entries(notes)) {
    const el = $(`[name="${name}"]`); if (!el) continue;
    const fld = el.closest('.fld') || el.parentElement;
    fld.querySelector('.hk-note')?.remove();
    const h = t.hotkeys && t.hotkeys[k];
    let msg = '';
    if (S.settings.tray.enabled && h && h.ok === false) msg = `Windows refused ${h.label}: another program already uses it. Pick a different one.`;
    else if (S.settings.tray.enabled && h && h.ok === true) msg = `Active: ${h.label}`;
    else if (!S.settings.tray.enabled && S.settings.tray[name.split('.')[1]]) msg = 'Hotkeys work only while the tray icon is on.';
    if (msg) { const d = document.createElement('div'); d.className = 'hint hk-note small ' + (h && h.ok === false ? 'err' : 'muted'); d.textContent = msg; fld.appendChild(d); }
  }
}

let backupsCache = null;
async function refreshBackups() { backupsCache = await call('/ui/backups'); paintBackups(); }
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function paintBackups() {
  const box = $('#backup-box');
  if (!box) return;
  const d = backupsCache;
  if (!d) { box.textContent = 'Loading\u2026'; return; }
  const rows = d.backups.map((b) => `<tr data-bk="${esc(b.name)}"><td>${esc(new Date(b.createdAt).toLocaleString())}</td><td>${esc(b.reason)}</td><td class="num">${fmtBytes(b.bytes)}</td><td style="text-align:right"><button class="btn sm" type="button" data-bk-restore>Restore</button> <button class="btn sm ghost icon" type="button" data-bk-del title="Delete this backup">${icon('trash')}</button></td></tr>`).join('');
  box.innerHTML = (d.pending ? `<div class="pf warn" style="margin-bottom:10px"><span class="dot warn"></span><span style="flex:1">Restore of ${esc(d.pending.name)} is staged. It is applied the next time the manager starts.</span><button class="btn sm" type="button" data-bk-cancel>Cancel</button><button class="btn sm" type="button" data-bk-quit>Quit now</button></div>` : '')
    + (rows ? `<table class="fleet-table"><thead><tr><th>Made</th><th>Why</th><th>Size</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted">No backups yet.</div>');
}
$('#settings-form').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-bk]');
  const name = row && row.dataset.bk;
  if (e.target.closest('[data-bk-quit]')) { $('#btn-quit').click(); return; }
  if (!e.target.closest('[data-bk-cancel],[data-bk-restore],[data-bk-del]')) return;
  run(async () => {
    if (e.target.closest('[data-bk-cancel]')) { await call('/ui/backups/cancel', {}); toast('ok', 'Restore cancelled'); await refreshBackups(); }
    else if (e.target.closest('[data-bk-restore]') && name) {
      if (!await confirmDialog('Restore this backup?', 'Your accounts, settings and run history are replaced by this backup the next time the manager starts. What you have now is backed up first, so you can undo it. Nothing changes until you restart.', { ok: 'Stage restore', danger: true })) return;
      await call('/ui/backups/restore', { name });
      toast('ok', 'Restore staged. It is applied at the next start.');
      await refreshBackups();
    } else if (e.target.closest('[data-bk-del]') && name) {
      if (!await confirmDialog('Delete this backup?', 'This cannot be undone.', { ok: 'Delete', danger: true })) return;
      await call('/ui/backups/delete', { name });
      await refreshBackups();
    }
  });
});
const settingsCollapsed = new Set();
const secKey = (h) => h.textContent.trim().toLowerCase();
function applySettingsFilter() {
  const form = $('#settings-form');
  const q = (($('#settings-search') || {}).value || '').trim().toLowerCase();
  let shown = 0;
  form.querySelectorAll('.settings-grid > .card').forEach((card) => {
    const h = card.querySelector('h3');
    const title = h ? secKey(h) : '';
    const flds = [...card.querySelectorAll('.fld')];
    let any = !q;
    if (q) {
      const titleHit = title.includes(q);
      if (flds.length) flds.forEach((f) => { const hit = titleHit || f.dataset.q.includes(q); f.classList.toggle('hidden', !hit); if (hit) any = true; });
      else any = titleHit || card.textContent.toLowerCase().includes(q);
    } else flds.forEach((f) => f.classList.remove('hidden'));
    card.classList.toggle('hidden', !any);
    card.classList.toggle('collapsed', !q && settingsCollapsed.has(title));
    if (any) shown++;
  });
  let nr = form.querySelector('.no-results');
  if (q && !shown) {
    if (!nr) { nr = document.createElement('div'); nr.className = 'no-results'; form.querySelector('.settings-grid').after(nr); }
    nr.textContent = `No settings match "${q}".`;
  } else if (nr) nr.remove();
}
function decorateSettings() {
  $$('#settings-form .settings-grid > .card > h3').forEach((h) => h.insertAdjacentHTML('beforeend', icon('chevron').replace('class="i"', 'class="i chev"')));
  applySettingsFilter();
}
$('#settings-search').addEventListener('input', applySettingsFilter);
$('#settings-form').addEventListener('click', (e) => {
  const h = e.target.closest('.settings-grid > .card > h3');
  if (!h) return;
  const key = secKey(h);
  const card = h.parentElement;
  if (card.classList.toggle('collapsed')) settingsCollapsed.add(key);
  else { settingsCollapsed.delete(key); card.classList.add('unfold'); setTimeout(() => card.classList.remove('unfold'), 360); }
});
const EXEC_STATUS = { running: 'open', starting: 'starting', waiting: 'restarting', held: 'closed on purpose', closed: 'closed', standby: 'waiting for you to open it', throttled: 'paused', error: 'problem', off: 'not watched' };
let execFinder = { programs: null, files: null, dir: '' };
// The choice is already saved on the server; this keeps the open form in step so a later Save does not undo it.
function execFieldsNow(p, name) {
  const set = (n, v) => { const el = document.querySelector(`#settings-form [name="${n}"]`); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
  set('executor.enabled', true);
  set('executor.path', p);
  set('executor.processName', name);
}
function paintExecFinder() {
  const box = $('#exec-finder');
  if (!box) return;
  const ex = S && S.executor;
  const now = ex ? `${esc(ex.name)}${ex.profile ? ` (${esc(ex.profile)})` : ''}: ${esc(EXEC_STATUS[ex.status] || ex.status)}${ex.elevated ? (ex.adminTask === 'ready' ? ' · runs as administrator' : ' \u00b7 runs as administrator, so Windows asks before it is opened') : ''}${ex.enabled && !ex.pathKnown ? ' · location not known yet' : ''}` : '';
  const progs = (execFinder.programs || []).map((p, i) => `<div class="exec-row"><div class="nm">${esc(p.name)}${p.profile ? `<span class="tag">${esc(p.profile)}</span>` : ''}</div><div class="muted small">${p.memMB} MB${p.count > 1 ? ` · ${p.count} processes` : ''}</div><button type="button" class="btn sm" data-exec-prog="${i}">Use</button></div>`).join('');
  const files = (execFinder.files || []).map((f, i) => `<div class="exec-row"><div class="nm" title="${esc(f.path)}">${esc(f.rel)}${f.inUse ? '<span class="tag on">open now</span>' : ''}${f.profile ? `<span class="tag">${esc(f.profile)}</span>` : ''}</div><div class="muted small">${f.sizeMB} MB</div><button type="button" class="btn sm" data-exec-file="${i}">Use</button></div>`).join('');
  box.innerHTML = `<div class="exec-find">
    <div class="small muted">Works with any executor (Potassium, Volt, Madium, Real and others). Pick the one you use, or paste the path to its .exe below.</div>
    ${now ? `<div class="small exec-now">${now}</div>` : ''}
    ${ex && ex.pathKnown ? `<div class="exec-admin"><div class="small">${({ ready: 'Opens and closes without a Windows prompt (set up once).', stale: 'The one-time setup is for another program. Set it up again for this one.', none: 'Opening it again needs a Windows prompt each time. Set it up once so the manager can do it alone, even when you are away.' })[ex.adminTask] || ''}</div><div class="btn-row"><button type="button" class="btn sm" data-exec-task="setup">${ex.adminTask === 'ready' ? 'Set up again' : 'Set up (one Windows prompt)'}</button>${ex.adminTask !== 'none' ? '<button type="button" class="btn sm" data-exec-task="remove">Remove</button>' : ''}</div></div>` : ''}
    <div class="btn-row"><button type="button" class="btn sm" data-exec-find>Find open programs</button></div>
    ${execFinder.programs ? (progs ? `<div class="exec-list">${progs}</div>` : '<div class="small muted">No programs to show. Open your executor first.</div>') : ''}
    <div class="exec-dirrow"><input id="exec-dir" type="text" placeholder="Or a folder to look in" value="${esc(execFinder.dir)}"><button type="button" class="btn sm" data-exec-scan>Look in folder</button></div>
    ${execFinder.files ? (files ? `<div class="exec-list">${files}</div>` : '<div class="small muted">No .exe files found there.</div>') : ''}
  </div>`;
}
$('#settings-form').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-exec-find],[data-exec-scan],[data-exec-prog],[data-exec-file],[data-exec-task]');
  if (!b) return;
  try {
    if (b.hasAttribute('data-exec-task')) {
      const remove = b.dataset.execTask === 'remove';
      if (!remove) toast('ok', 'Windows will ask for permission once. Choose Yes.');
      b.disabled = true;
      try { await call('/ui/executor/task', { action: remove ? 'remove' : 'setup' }); } finally { b.disabled = false; }
      toast('ok', remove ? 'The setup was removed' : 'Done. The executor now opens and closes without a prompt');
    } else if (b.hasAttribute('data-exec-find')) { execFinder.programs = (await call('/ui/executor/running', {})).programs; paintExecFinder(); }
    else if (b.hasAttribute('data-exec-scan')) { execFinder.dir = $('#exec-dir').value.trim(); execFinder.files = (await call('/ui/executor/scan', { dir: execFinder.dir })).files; paintExecFinder(); }
    else if (b.hasAttribute('data-exec-prog')) { const p = execFinder.programs[Number(b.dataset.execProg)]; await call('/ui/executor/use', { name: p.name }); execFieldsNow('', p.name); toast('ok', `Watching ${p.name}`); }
    else { const f = execFinder.files[Number(b.dataset.execFile)]; await call('/ui/executor/use', { path: f.path }); execFieldsNow(f.path, f.name); toast('ok', `Watching ${f.name}`); }
  } catch (err) { toast('error', err.message); }
});
const NAV_POS = [['left', 'Left'], ['top', 'Top'], ['bottom', 'Bottom']];
const NAV_SIZE = [['full', 'Full'], ['compact', 'Compact (floating)']];
const ACCENTS = [['', 'White', '#f2f2f4'], ['blue', 'Blue', '#3c5cdc'], ['teal', 'Teal', '#14b8a6'], ['violet', 'Violet', '#8b6cff'], ['rose', 'Rose', '#f43f6e'], ['amber', 'Amber', '#f59e0b']];
const look = {
  get(k, d) { try { return localStorage.getItem('iram_' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('iram_' + k, v); } catch { /* private mode */ } },
};
function applyLook() {
  const de = document.documentElement;
  const acc = look.get('accent', '');
  if (acc) de.setAttribute('data-accent', acc); else de.removeAttribute('data-accent');
  if (look.get('motion', 'on') === 'off') de.setAttribute('data-motion', 'off'); else de.removeAttribute('data-motion');
  const np = look.get('nav', 'left'), ns = look.get('navsize', 'full');
  de.setAttribute('data-nav', np === 'top' || np === 'bottom' ? np : 'left');
  de.setAttribute('data-navsize', ns === 'compact' || ns === 'tiny' ? 'compact' : 'full');
}
function relayoutNav() { navIndPlaced = false; applyLook(); requestAnimationFrame(placeNavInd); }
function appearanceCard() {
  const acc = look.get('accent', '');
  const sw = ACCENTS.map(([id, name, col]) => '<button type="button" class="swatch ' + (acc === id ? 'on' : '') + '" data-accent="' + id + '" title="' + name + '" aria-label="' + name + '" style="--c:' + col + '"></button>').join('');
  const off = look.get('motion', 'on') === 'off';
  return '<div class="card"><h3>' + icon('contrast') + 'Appearance</h3><p class="small muted" style="margin:0 0 6px">Saved in this window only, applied instantly. No need to press Save.</p><label class="f">Accent colour</label><div class="swatches">' + sw + '</div><label class="f">Navigation position</label><div class="seg">' + NAV_POS.map(([id, name]) => '<button type="button" class="' + (look.get('nav', 'left') === id ? 'on' : '') + '" data-look="nav" data-v="' + id + '">' + name + '</button>').join('') + '</div><label class="f">Navigation size</label><div class="seg">' + NAV_SIZE.map(([id, name]) => '<button type="button" class="' + (look.get('navsize', 'full') === id ? 'on' : '') + '" data-look="navsize" data-v="' + id + '">' + name + '</button>').join('') + '</div><p class="small muted" style="margin:6px 0 4px">Compact is a small floating bar with icons only, as big as its buttons. The button in the navigation switches between the two.</p><div class="toggle-row"><label class="switch"><input type="checkbox" id="look-motion" ' + (off ? 'checked' : '') + '><span></span></label><div class="txt">Reduce animations<small>Turns off the page, dialog and toast transitions. Windows\' own reduce-motion setting is always respected too.</small></div></div></div>';
}
$('#settings-form').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-accent]');
  if (!b) return;
  look.set('accent', b.dataset.accent); applyLook();
  $$('#settings-form [data-accent]').forEach((x) => x.classList.toggle('on', x === b));
});
$('#settings-form').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-look]');
  if (!b) return;
  look.set(b.dataset.look, b.dataset.v); relayoutNav();
  $$('#settings-form [data-look="' + b.dataset.look + '"]').forEach((x) => x.classList.toggle('on', x === b));
});
$('#btn-navsize').addEventListener('click', () => {
  const order = ['full', 'compact'];
  look.set('navsize', order[(order.indexOf(look.get('navsize', 'full')) + 1) % order.length]); relayoutNav();
  $$('#settings-form [data-look="navsize"]').forEach((x) => x.classList.toggle('on', x.dataset.v === look.get('navsize', 'full')));
});
$('#settings-form').addEventListener('change', (e) => {
  if (e.target.id !== 'look-motion') return;
  look.set('motion', e.target.checked ? 'off' : 'on'); applyLook();
});
applyLook();

function presetCard() {
  const pr = S.presets;
  if (!pr || !pr.list) return '';
  const cur = pr.current;
  const cards = pr.list.map((p) => {
    const n = p.changes.length;
    const sub = cur === p.id ? 'In use' : n ? n + ' setting' + (n === 1 ? '' : 's') + ' would change' : 'Matches your settings';
    return '<button type="button" class="opt-card ' + (cur === p.id ? 'on' : '') + '" data-preset="' + esc(p.id) + '"><b>' + esc(p.name) + '</b><small>' + esc(p.blurb) + '</small><small class="preset-sub">' + esc(sub) + '</small></button>';
  }).join('');
  return '<div class="card preset-card"><h3>' + icon('zap') + 'Performance preset</h3><p class="small muted" style="margin:0 0 10px">One click sets FPS, graphics, window size, priority, memory trim, CPU cap and minimized-window handling together. ' + (cur === 'custom' ? 'Your current mix does not match a preset.' : '') + ' Applies to clients you launch next.</p><div class="opt-grid">' + cards + '</div><div class="small muted" id="preset-preview" style="margin-top:8px"></div></div>';
}
function presetValue(k, v) {
  if (k === 'cpuCapPct') return v ? v + '%' : 'off';
  if (k === 'minimizedAction') return v === 'park' ? 'move off-screen' : 'leave';
  if (k === 'windowWidth' || k === 'windowHeight' || k === 'fpsCap' || k === 'graphicsLevel') return v ? String(v) : 'default';
  if (k === 'trimMemoryMin') return v ? (v < 1 ? Math.round(v * 60) + ' s' : v + ' min') : 'off';
  return String(v);
}
$('#settings-form').addEventListener('mouseover', (e) => {
  const b = e.target.closest && e.target.closest('[data-preset]');
  const box = $('#preset-preview');
  if (!box) return;
  if (!b || !S || !S.presets) { box.textContent = ''; return; }
  const p = S.presets.list.find((x) => x.id === b.dataset.preset);
  box.textContent = p && p.changes.length ? 'Would change: ' + p.changes.map((c) => c.label + ' ' + presetValue(c.key, c.from) + ' \u2192 ' + presetValue(c.key, c.to)).join(' \u00b7 ') : '';
});
$('#settings-form').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-preset]');
  if (!b) return;
  run(async () => {
    const r = await call('/ui/preset', { id: b.dataset.preset });
    toast('ok', r.changes.length ? 'Preset applied: ' + r.changes.length + ' setting' + (r.changes.length === 1 ? '' : 's') + ' changed' : 'Preset already matched');
    renderSettings(true);
  });
});

function renderSettings(force) {
  if (!S) return;
  const st = S.settings;
  const sig = JSON.stringify([st, S.tray, S.vaultMode, S.roblox && S.roblox.path, S.browserFound, S.apiUrl]);
  if (!force && sig === settingsSig && $('#settings-form').firstChild) return;
  settingsSig = sig;
  const field = ([key, type, label, hint]) => {
    const v = getPath(st, key);
    const h = hint ? `<div class="hint">${esc(hint)}</div>` : '';
    if (type === 'bool') return `<div class="toggle-row"><label class="switch"><input type="checkbox" name="${key}" ${v ? 'checked' : ''}><span></span></label><div class="txt">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>`;
    let input;
    if (Array.isArray(type) && type.length <= 4) type = { seg: type }; // a few choices read better as chips than as a drop-down
    if (Array.isArray(type)) input = `<select name="${key}">${type.map(([val, txt]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
    else if (type && type.seg) {
      const opts = type.seg.slice();
      if (!opts.some(([o]) => String(o) === String(v))) { opts.push([v, `${v} (current)`]); opts.sort((a, b) => Number(a[0]) - Number(b[0])); }
      input = `<div class="seg" data-seg>${opts.map(([o, t]) => `<button type="button" data-v="${esc(o)}" class="${String(o) === String(v) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div><input type="hidden" name="${key}" value="${esc(v)}">`;
    }
    else if (type && type.tpl) {
      input = `<input name="${key}" type="text" value="${esc(v)}"><div class="tpl">${type.tpl.map(([tok, txt]) => `<button type="button" data-tpl-ins="${esc(tok)}" data-replace="${type.replace ? 1 : 0}" title="${esc(tok)}">${esc(txt)}</button>`).join('')}${type.replace ? '<button type="button" data-tpl-clear>None</button>' : ''}</div>`;
    }
    else if (type === 'time') input = `<input name="${key}" type="time" value="${esc(v)}">`;
    else if (type === 'days') {
      const on = String(v == null ? '' : v);
      input = `<div class="seg multi days" data-days>${DAY_NAMES.map(([d, n]) => `<button type="button" data-v="${d}" class="${on.includes(d) ? 'on' : ''}">${n}</button>`).join('')}</div><input type="hidden" name="${key}" value="${esc(on)}">`;
    }
    else if (type === 'hotkey') input = `<div class="hk"><input name="${key}" class="rec" readonly value="${esc(v)}" placeholder="Click here, then press the keys"><button type="button" class="btn sm" data-hk-clear>Clear</button><span class="hk-state"></span></div>`;
    else if (type === 'afkkey') input = `<select name="${key}"><option value="">Choose a key</option>${AFK_KEYS.map((k) => `<option value="${k}" ${String(v).toUpperCase() === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea name="${key}" style="min-height:70px">${esc(v)}</textarea>`;
    else if (type === 'password') input = `<input type="password" name="${key}" placeholder="${st.api.passwordSet ? '•••••••• (set)' : 'not set'}" autocomplete="new-password">`;
    else input = `<input name="${key}" type="${type === 'num' ? 'number' : 'text'}" value="${esc(v)}">`;
    return `<label class="f">${esc(label)}</label>${input}${h}`;
  };
  $('#settings-form').innerHTML = `<div class="settings-grid">${presetCard()}${appearanceCard()}${SETTINGS.map(([title, ic, items]) => `<div class="card"><h3>${icon(ic)}${esc(title)}</h3>${title === 'Executor' ? '<div id="exec-finder"></div>' : ''}${items.map((it) => `<div class="fld" data-q="${esc((String(it[2]) + ' ' + (it[3] || '') + ' ' + it[0]).toLowerCase())}">${field(it)}</div>`).join('')}</div>`).join('')}
    <div class="card"><h3>${icon('lock')}Vault security</h3>
      <p class="small muted" style="margin-top:0">${S.vaultMode === 'scrypt' ? 'Protected by your master password (AES-256-GCM + scrypt). You unlock it on every start.' : 'Protected by Windows DPAPI (AES-256-GCM key tied to your Windows user). Opens automatically.'}</p>
      ${S.vaultMode === 'scrypt' ? '<label class="f">Current master password</label><input type="password" id="mp-current">' : ''}
      <label class="f">New master password</label><input type="password" id="mp-new" placeholder="${S.vaultMode === 'scrypt' ? 'Blank = remove (use Windows DPAPI)' : 'At least 6 characters'}">
      <div class="btn-row"><button class="btn" type="button" id="btn-mp">${S.vaultMode === 'scrypt' ? 'Change / remove password' : 'Set master password'}</button></div>
    </div>
    <div class="card"><h3>${icon('shield')}Backups</h3>
      <p class="small muted" style="margin-top:0">Copies of your accounts vault (still encrypted), settings and run history. One is made automatically each day, and the newest 10 are kept.</p>
      <div id="backup-box" class="small"></div>
      <div class="btn-row"><button class="btn" type="button" id="btn-backup-now">Back up now</button></div>
    </div>
    <div class="card"><h3>${icon('power')}App</h3>
      <p class="small muted" style="margin-top:0">"Start Manager.vbs" (or the desktop shortcut) runs the manager without a console window. Quitting never closes your Roblox clients.</p>
      <div class="btn-row"><button class="btn" type="button" id="btn-shortcut">Create desktop shortcut</button><button class="btn" type="button" id="btn-test-alert">${icon('bell')}Send test alert</button><button class="btn" type="button" id="btn-captcha-test">CAPTCHA simulator</button><button class="btn" type="button" id="btn-diag">Export diagnostics</button></div>
      <p class="small muted" style="margin:8px 0 0">Diagnostics is a text file for bug reports: versions, findings, fleet and run summaries, settings and recent activity. Cookies, passwords, webhooks, account names and your Windows user name are left out.</p>
    </div>
    <div class="card"><h3>${icon('server')}API reference</h3><div class="small muted">Base: <span class="mono">${esc(S.apiUrl)}</span><br>
      <span class="mono">accounts</span> · <span class="mono">status</span> · <span class="mono">launch?account=NAME&placeId=ID[&jobId=]</span> · <span class="mono">kill?account=</span> · <span class="mono">keepalive?account=&placeId=&enabled=true</span> · <span class="mono">field?account=&key=[&value=]</span> · <span class="mono">cookie?account=</span><br>
      Send the password as header <span class="mono">X-Api-Password</span> or <span class="mono">?password=</span>.</div>
      <div class="small" style="margin-top:8px">Roblox: <span class="mono">${S.roblox ? esc(S.roblox.path) : 'not found'}</span><br>Login browser: ${S.browserFound ? 'found' : '<span class="err">not found</span>'}</div></div>
  </div>
  <div class="save-bar"><button class="btn primary" type="submit" id="settings-save">Save settings</button><span class="muted small" id="settings-state"></span></div>`;
  settingsDirty = false;
  decorateSettings();
  paintTrayStatus();
  paintBackups();
  paintExecFinder();
  bind($('#btn-backup-now'), async () => { const b = await call('/ui/backups/create', {}); toast('ok', `Backup made: ${b.name}`); await refreshBackups(); });
  bind($('#btn-mp'), changeMasterPassword);
  bind($('#btn-diag'), exportDiagnostics);
  bind($('#btn-captcha-test'), openCaptchaTest);
  bind($('#btn-shortcut'), async () => { await call('/ui/shortcut', {}); toast('ok', 'Shortcut "Roblox Account Manager" added to your desktop'); });
  bind($('#btn-test-alert'), async () => {
    if (settingsDirty) throw new Error('Save settings first');
    await call('/ui/alerts/test', {}); toast('ok', 'Test alert sent - check your Discord channel');
  });
}
$('#settings-form').addEventListener('input', (e) => { if (e.target && e.target.id === 'exec-dir') return; settingsDirty = true; const s = $('#settings-state'); if (s) s.textContent = 'Unsaved changes'; });
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => {
    const patch = {};
    for (const [, , items] of SETTINGS) for (const [key, type] of items) {
      const el = $(`[name="${key}"]`, e.target);
      if (!el) continue;
      const isNum = type === 'num' || !!(type && type.num);
      setPath(patch, key, type === 'bool' ? el.checked : isNum ? Number(el.value) : el.value);
    }
    await call('/ui/settings', patch);
    settingsDirty = false;
    toast('ok', 'Settings saved');
    renderSettings(true);
  });
});
const markSettingsDirty = () => { settingsDirty = true; const s = $('#settings-state'); if (s) s.textContent = 'Unsaved changes'; };
$('#settings-form').addEventListener('click', (e) => {
  const sb = e.target.closest('.seg button');
  if (sb && sb.hasAttribute('data-look')) return; // appearance choices apply instantly and are not part of Save
  if (sb) {
    const seg = sb.parentElement, hid = seg.nextElementSibling;
    if (seg.hasAttribute('data-days')) { sb.classList.toggle('on'); hid.value = [...seg.querySelectorAll('button.on')].map((b) => b.dataset.v).join(''); }
    else { seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === sb)); hid.value = sb.dataset.v; }
    markSettingsDirty();
    return;
  }
  const ti = e.target.closest('[data-tpl-ins]');
  if (ti) {
    const inp = ti.closest('.fld').querySelector('input[type=text]');
    const tok = ti.dataset.tplIns;
    if (ti.dataset.replace === '1') inp.value = tok;
    else { const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a; inp.value = inp.value.slice(0, a) + tok + inp.value.slice(b); inp.setSelectionRange(a + tok.length, a + tok.length); }
    markSettingsDirty();
    return;
  }
  if (e.target.closest('[data-tpl-clear]')) { e.target.closest('.fld').querySelector('input[type=text]').value = ''; markSettingsDirty(); return; }
  const hc = e.target.closest('[data-hk-clear]');
  if (hc) { const i = hc.parentElement.querySelector('input.rec'); i.value = ''; const st = hc.parentElement.querySelector('.hk-state'); if (st) st.textContent = 'Cleared'; markSettingsDirty(); }
});
// Hotkey recorder: press the combination instead of typing it.
$('#settings-form').addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input.rec') || e.key === 'Tab') return;
  e.preventDefault(); e.stopPropagation();
  const st = el.parentElement.querySelector('.hk-state');
  const say = (m) => { if (st) st.textContent = m; };
  const held = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
  if (e.key === 'Escape') { el.blur(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) { say(held.join('+') + '+...'); return; }
  const mods = e.ctrlKey || e.altKey || e.metaKey;
  if ((e.key === 'Backspace' || e.key === 'Delete') && !mods) { el.value = ''; say('Cleared'); markSettingsDirty(); return; }
  const fk = /^F([1-9]|1\d|2[0-4])$/;
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : fk.test(e.code) ? e.code
    : /^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase() : fk.test(e.key) ? e.key : ''; // key as a fallback when no physical code is reported
  if (!k) { say('Use a letter, a digit or F1 to F24'); return; }
  if (!mods) { say('Add Ctrl, Alt or Win'); return; }
  el.value = held.concat(k).join('+');
  say('Press Save to apply');
  markSettingsDirty();
});
$('#settings-form').addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('input.rec')) { e.target.classList.add('listening'); const st = e.target.parentElement.querySelector('.hk-state'); if (st) st.textContent = 'Press the keys...'; } });
$('#settings-form').addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('input.rec')) { e.target.classList.remove('listening'); const st = e.target.parentElement.querySelector('.hk-state'); if (st && st.textContent === 'Press the keys...') st.textContent = ''; } });
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
  renderSettings(true);
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
function logFilter() {
  const q = ($('#log-search').value || '').trim().toLowerCase();
  return (l) => (!logLevel || (logLevel === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error'))
    && (!q || l.msg.toLowerCase().includes(q) || l.scope.toLowerCase().includes(q));
}
function renderLogs() {
  const ok = logFilter();
  const view = $('#log-view');
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
  view.innerHTML = logs.filter(ok).slice(-1000).map((l) => `<span class="lv-t">${new Date(l.t).toLocaleTimeString()}</span> <span class="lv-s">${esc(l.scope)}</span> <span class="lv-${l.level}">${esc(l.msg)}</span>`).join('\n') || '<span class="muted">Nothing yet.</span>';
  if (atBottom) view.scrollTop = view.scrollHeight;
}

// ============================================================ keyboard
function openShortcuts() {
  const rows = [
    ['Ctrl K', 'Command palette: every action and setting'],
    ['Alt 1 \u2013 6', 'Go to Clients, Accounts, Servers, Activity, Experiments, Settings'],
    ['Ctrl F', 'Search accounts'],
    ['Ctrl A', 'Select every visible account except your Main account'],
    ['Enter', 'Launch the selected accounts'],
    ['Delete', 'Remove the selected accounts (asks first)'],
    ['Esc', 'Close a dialog or menu, or clear the selection'],
    ['Click, Ctrl click, Shift click', 'Select one, add or remove one, select a range'],
    ['Double click, right click', 'Open account details, open the account menu'],
    ['?', 'This sheet'],
  ];
  openDialog('<h2>Keyboard shortcuts</h2><div class="kbd-list">' + rows.map(([k, t]) => '<div class="kbd-row"><span class="kbd">' + esc(k) + '</span><span>' + esc(t) + '</span></div>').join('') + '</div><div class="foot"><button class="btn primary" data-close>Close</button></div>');
}
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select, button, a, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#palette')) closePalette(); else if (S && !S.locked && !$('#dialog')) openPalette(); return; }
  if (e.altKey && !e.ctrlKey && /^[1-6]$/.test(e.key) && !$('#palette') && !$('#dialog')) { e.preventDefault(); showTab(PAGES[Number(e.key) - 1][0]); return; }
  if (e.key === 'Escape') {
    if ($('#palette')) return closePalette();
    if ($('#menu')) return closeMenu();
    if ($('#dialog')) return closeDialog();
    if (!typing && selected.size) { selected.clear(); selectionChanged(); }
    return;
  }
  if (e.key === '?' && !typing && !$('#dialog') && !$('#palette') && S && !S.locked) { e.preventDefault(); openShortcuts(); return; }
  if (!$('#tab-accounts').classList.contains('active') || $('#dialog')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#filter').focus(); return; }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); visibleAccounts().filter((a) => !a.main).forEach((a) => selected.add(a.id)); selectionChanged(); }
  else if (e.key === 'Delete' && selected.size) run(() => ACT.del(selIds()));
  else if (e.key === 'Enter' && selected.size) run(() => ACT.launch(selIds()));
});

// ============================================================ experiments
let expTimer = null;
const EXP_VARS = {
  graphicsApi: { label: 'Graphics API', desc: 'Which renderer Roblox draws with.', options: [['auto', 'Automatic'], ['d3d11', 'Direct3D 11'], ['vulkan', 'Vulkan'], ['opengl', 'OpenGL']], pick: ['d3d11', 'vulkan'] },
  fastProfile: { label: 'Texture preset', desc: 'Lower textures and effects to save memory.', options: [['off', 'Off'], ['low', 'Low'], ['lowest', 'Lowest']], pick: ['off', 'low'] },
  fpsCap: { label: 'FPS cap', desc: 'How fast idle clients may draw.', options: [[0, 'Roblox default'], [15, '15'], [30, '30'], [60, '60'], [120, '120']], pick: [30, 60] },
  graphicsLevel: { label: 'Quality level', desc: "Roblox's in-game graphics quality.", options: [[1, '1 (lowest)'], [3, '3'], [5, '5'], [7, '7'], [10, '10 (highest)']], pick: [1, 5] },
  executorRun: { label: 'Executor', desc: 'Whether your executor program is open while clients run. It is closed for the Closed round and opened again afterwards.', options: [['off', 'Closed'], ['on', 'Open']], pick: ['off', 'on'] },
  clientPriority: { label: 'CPU priority', desc: 'How much CPU time clients get compared with your PC.', options: [['Normal', 'Normal'], ['BelowNormal', 'Below normal'], ['Idle', 'Low (idle)']], pick: ['Normal', 'Idle'] },
};
const EXP_MINUTES = [12, 20, 30, 45, 60];
const expState = { built: false, variable: '', values: new Set(), minutes: 20, game: '__launch__', custom: '', running: false, pastSig: '' };
const expLabel = (meta, o) => (meta.options.find(([v]) => String(v) === String(o)) || [o, o])[1];
const expSetDefaults = () => { expState.values = new Set(EXP_VARS[expState.variable].pick.map(String)); };
const expDuration = (min) => (min >= 120 ? (min / 60).toFixed(1).replace(/\.0$/, '') + ' h' : min + ' min');

function expGame() {
  if (expState.game === '__launch__') { const li = launchInput(); return { input: li.input, jobId: li.jobId }; }
  if (expState.game === '__custom__') return { input: expState.custom.trim(), jobId: '' };
  const f = ((S && S.settings.favorites) || [])[Number(expState.game)];
  return f ? { input: f.input, jobId: f.jobId || '' } : { input: '', jobId: '' };
}
function expProblems() {
  const p = [];
  if (expState.values.size < 2) p.push('pick at least two values');
  if (!selIds().length) p.push('choose the accounts to use');
  if (!expGame().input) p.push('choose a game');
  return p;
}

function buildExperiment(r) {
  const vars = r.variables.filter((v) => EXP_VARS[v]);
  if (!expState.variable || !vars.includes(expState.variable)) { expState.variable = vars[0] || ''; if (expState.variable) expSetDefaults(); }
  $('#exp-builder').innerHTML = `
    <div class="step"><div class="step-n">1</div><div><h4>What do you want to compare?</h4>
      <div class="opt-grid" id="exp-vars">${vars.map((v) => `<button type="button" class="opt-card" data-var="${v}"><b>${esc(EXP_VARS[v].label)}</b><small>${esc(EXP_VARS[v].desc)}</small></button>`).join('')}</div></div></div>
    <div class="step"><div class="step-n">2</div><div><h4>Which values?<span class="muted">Pick two or more. Each value runs as its own round.</span></h4><div class="seg multi" id="exp-vals"></div></div></div>
    <div class="step"><div class="step-n">3</div><div><h4>How long should each round run?<span class="muted">The first 5 minutes of every client are ignored as loading.</span></h4>
      <div class="seg" id="exp-mins">${EXP_MINUTES.map((m) => `<button type="button" data-min="${m}">${m} min</button>`).join('')}</div></div></div>
    <div class="step"><div class="step-n">4</div><div><h4>Which game?</h4><select id="exp-game"></select><input id="exp-custom" placeholder="Place ID or game link" style="margin-top:8px;display:none"></div></div>
    <div class="step"><div class="step-n">5</div><div><h4>Which accounts?<span class="muted">Use at least 3 for a meaningful verdict.</span></h4>
      <div class="exp-accts" id="exp-accts"></div>
      <div class="exp-actions"><button type="button" class="btn sm" id="exp-pick3">Use 3 valid accounts</button><button type="button" class="btn sm" data-goto="accounts">Choose on the Accounts page</button><button type="button" class="btn sm ghost" id="exp-clear">Clear</button></div></div></div>
    <div class="exp-summary" id="exp-sum"></div>
    <div class="exp-actions"><button class="btn primary" id="exp-start" type="button">Start experiment</button><button class="btn" id="exp-stop" type="button">Stop</button></div>`;
  expState.built = true;
}

function paintExp() {
  if (!expState.built || !S) return;
  const meta = EXP_VARS[expState.variable];
  $$('#exp-vars .opt-card').forEach((b) => b.classList.toggle('on', b.dataset.var === expState.variable));
  const vh = meta ? meta.options.map(([o, t]) => `<button type="button" data-val="${esc(o)}" class="${expState.values.has(String(o)) ? 'on' : ''}">${esc(t)}</button>`).join('') : '';
  if ($('#exp-vals').dataset.sig !== vh) { $('#exp-vals').innerHTML = vh; $('#exp-vals').dataset.sig = vh; }
  $$('#exp-mins button').forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === expState.minutes));
  const favs = S.settings.favorites || [];
  const li = launchInput().input;
  const gh = [`<option value="__launch__">Use the game in the Launch box (${li ? esc(li.length > 40 ? li.slice(0, 40) + '...' : li) : 'nothing entered yet'})</option>`,
    ...favs.map((f, i) => `<option value="${i}">${esc(f.name || f.input)}</option>`), '<option value="__custom__">Another game...</option>'].join('');
  const gs = $('#exp-game');
  if (gs.dataset.sig !== gh) { gs.innerHTML = gh; gs.dataset.sig = gh; }
  if (![...gs.options].some((o) => o.value === expState.game)) expState.game = '__launch__';
  gs.value = expState.game;
  $('#exp-custom').style.display = expState.game === '__custom__' ? '' : 'none';
  const ids = selIds();
  $('#exp-accts').innerHTML = ids.length
    ? ids.slice(0, 8).map((id) => { const a = accById(id); return `<span class="tag">${esc(a ? nameOf(a) : String(id))}</span>`; }).join('') + (ids.length > 8 ? `<span class="muted">+${ids.length - 8} more</span>` : '')
    : '<span class="muted">None chosen yet</span>';
  const probs = expProblems();
  const k = expState.values.size;
  let sum;
  if (probs.length) sum = `<span class="bad">Before you can start: ${probs.join(', ')}.</span>`;
  else {
    const labels = meta.options.filter(([o]) => expState.values.has(String(o))).map(([o, t]) => t).join(', ');
    sum = `Compares <b>${esc(labels)}</b> for <b>${esc(meta.label)}</b> on <b>${ids.length}</b> account${ids.length === 1 ? '' : 's'}. ${k} rounds of ${expState.minutes} min is about <b>${expDuration(k * expState.minutes)}</b> plus launching and closing. Your current setting is put back afterwards.`;
    if (ids.length < 3) sum += '<br><span class="bad">With fewer than 3 accounts the report cannot give a verdict.</span>';
  }
  $('#exp-sum').innerHTML = sum;
  $('#exp-start').disabled = !!probs.length || expState.running;
  $('#exp-stop').disabled = !expState.running;
}

function renderExpStatus(r) {
  const c = r.current;
  expState.running = !!(c && c.status === 'running');
  $('#exp-status').innerHTML = !c ? '<p class="muted" style="margin:12px 0 0">No experiment has run in this session.</p>'
    : `<div class="exp-run"><b>${esc(c.name)}</b> <span class="tag">${esc(c.status)}</span>${c.phase ? ` <span class="muted">${esc(c.phase)}, round ${c.arm + 1}</span>` : ''}${c.error ? `<div class="err">${esc(c.error)}</div>` : ''}
      ${c.results.length ? `<table><thead><tr><th>Round</th><th>Baseline</th><th>Growth</th><th>Measured</th></tr></thead><tbody>${c.results.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.summary.baselineMB ?? 'n/a'} MB</td><td>${x.summary.slopeMBMin ?? 'n/a'} MB/min</td><td>${x.summary.measured}/${x.summary.clients}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}

async function renderExperiments() {
  let r;
  try { r = await call('/ui/experiments'); } catch (e) { $('#exp-status').textContent = e.message; return; }
  if (!expState.built) buildExperiment(r);
  renderExpStatus(r);
  paintExp();
  const sig = r.past.map((p) => p.name).join('|');
  if (sig !== expState.pastSig) {
    expState.pastSig = sig;
    $('#exp-past').innerHTML = '<h3>Past reports</h3>' + (r.past.length ? r.past.map((p) => '<details><summary>' + esc(p.name) + '</summary><pre>' + esc(p.text) + '</pre></details>').join('') : '<p class="muted">None yet.</p>');
  }
  try { renderProfiles(await call('/ui/profiles')); } catch { /* shown on next refresh */ }
  clearTimeout(expTimer);
  if ($('#tab-experiments').classList.contains('active')) expTimer = setTimeout(renderExperiments, expState.running ? 5000 : 15000);
}

$('#tab-experiments').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    const vc = t.closest('#exp-vars .opt-card');
    if (vc) { expState.variable = vc.dataset.var; expSetDefaults(); paintExp(); return; }
    const vb = t.closest('#exp-vals button');
    if (vb) { const k = vb.dataset.val; if (expState.values.has(k)) expState.values.delete(k); else expState.values.add(k); paintExp(); return; }
    const mb = t.closest('#exp-mins button');
    if (mb) { expState.minutes = Number(mb.dataset.min); paintExp(); return; }
    if (t.closest('#exp-pick3')) {
      const ok = S.accounts.filter((a) => a.status === 'valid' && !instOf(a.id)).slice(0, 3);
      if (!ok.length) return toast('error', 'No valid account without a running client');
      selected.clear(); ok.forEach((a) => selected.add(a.id)); selectionChanged(); paintExp(); return;
    }
    if (t.closest('#exp-clear')) { selected.clear(); selectionChanged(); paintExp(); return; }
    if (t.closest('#exp-start')) {
      const meta = EXP_VARS[expState.variable];
      const g = expGame();
      const values = meta.options.filter(([o]) => expState.values.has(String(o))).map(([o]) => o);
      await call('/ui/experiments/start', { variable: expState.variable, values, minutes: expState.minutes, ids: selIds(), input: g.input, jobId: g.jobId });
      toast('info', 'Experiment started'); renderExperiments(); return;
    }
    if (t.closest('#exp-stop')) { await call('/ui/experiments/stop', {}); toast('info', 'Stopping after the current step'); renderExperiments(); return; }
    const pa = t.closest('[data-prof-apply]');
    if (pa) { renderProfiles(await call('/ui/profiles/apply', { id: pa.dataset.profApply })); toast('ok', 'Profile applied. It takes effect on the next launch'); return; }
    const ps = t.closest('[data-prof-share]');
    if (ps) { const r = await call('/ui/profiles/export', { id: ps.dataset.profShare }); await navigator.clipboard.writeText(r.code); toast('ok', 'Profile code copied. Anyone can paste it under Import code'); return; }
    if (t.closest('#prof-import')) {
      const r = await call('/ui/profiles/import', { code: $('#prof-code').value });
      renderProfiles(r); $('#prof-code').value = '';
      toast('ok', 'Imported as "' + r.imported + '"' + (r.rejected && r.rejected.length ? ' (skipped: ' + r.rejected.join(', ') + ')' : ''));
      return;
    }
    const pd = t.closest('[data-prof-del]');
    if (pd) { renderProfiles(await call('/ui/profiles/delete', { name: pd.dataset.profDel.replace(/^saved:/, '') })); toast('ok', 'Profile deleted'); return; }
    if (t.closest('#audit-run')) { await runAudit(); return; }
    if (t.closest('#prof-save')) { renderProfiles(await call('/ui/profiles/save', { name: $('#prof-name').value })); toast('ok', 'Profile saved'); $('#prof-name').value = ''; return; }
  } catch (err) { toast('error', err.message); }
});
async function runAudit() {
  const out = $('#audit-out');
  const btn = $('#audit-run');
  btn.disabled = true;
  try {
    const r = await call('/ui/audit', { path: $('#audit-path').value });
    const sev = { warn: 'Check', info: 'Note' };
    out.innerHTML = '<p class="muted">Checked ' + r.checked + ' script' + (r.checked === 1 ? '' : 's') + (r.skipped ? ' (' + r.skipped + ' skipped: too large or over the limit)' : '') + '. ' +
      (r.warnings || r.notes ? r.warnings + ' to check, ' + r.notes + ' note' + (r.notes === 1 ? '' : 's') + '. ' : 'Nothing stood out. ') + (r.clean ? r.clean + ' with nothing to report.' : '') + '</p>' +
      r.results.map((f) => '<div class="audit-file"><b>' + esc(f.file) + '</b> <span class="muted">' + f.lines + ' lines</span>' +
        f.findings.map((x) => '<div class="audit-row ' + x.severity + '"><span class="audit-tag">' + sev[x.severity] + '</span><span class="audit-line">line ' + x.line + '</span><div><div>' + esc(x.message) + '</div><code>' + esc(x.text) + '</code></div></div>').join('') + '</div>').join('');
  } catch (err) { out.innerHTML = ''; toast('error', err.message); } finally { btn.disabled = false; }
}
$('#tab-experiments').addEventListener('change', (e) => { if (e.target.id === 'exp-game') { expState.game = e.target.value; paintExp(); } });
$('#tab-experiments').addEventListener('input', (e) => { if (e.target.id === 'exp-custom') { expState.custom = e.target.value; paintExp(); } });

const PROF_LABELS = { graphicsApi: 'Graphics API', fastProfile: 'Textures', fpsCap: 'FPS cap', graphicsLevel: 'Quality', clientPriority: 'CPU priority', noPowerThrottle: 'Efficiency mode', minimizedAction: 'Minimized' };
function profValue(k, v) {
  if (EXP_VARS[k]) return expLabel(EXP_VARS[k], v);
  if (k === 'noPowerThrottle') return v ? 'kept off' : 'Windows decides';
  if (k === 'minimizedAction') return v === 'park' ? 'move off-screen' : 'leave minimized';
  return String(v);
}
function renderProfiles(r) {
  const same = (p) => Object.keys(p.values).length === Object.keys(r.current).length && Object.entries(p.values).every(([k, v]) => String(r.current[k]) === String(v));
  const html = r.list.map((p) => {
    const on = same(p);
    return `<div class="prof-card ${on ? 'on' : ''}"><div class="pc-top"><b>${esc(p.label)}</b><span class="tag">${p.builtin ? 'Built in' : 'Saved'}</span>${on ? '<span class="tag" style="color:var(--accent-text)">In use</span>' : ''}</div>
      <div class="pc-vals">${Object.entries(p.values).map(([k, v]) => `<span class="tag">${esc(PROF_LABELS[k] || k)}: ${esc(profValue(k, v))}</span>`).join('')}</div>
      <div class="pc-act"><button type="button" class="btn sm" data-prof-apply="${esc(p.id)}" ${on ? 'disabled' : ''}>${on ? 'Applied' : 'Apply'}</button><button type="button" class="btn sm ghost" data-prof-share="${esc(p.id)}" title="Copy a code you can send to someone else">Copy code</button>${p.builtin ? '' : `<button type="button" class="btn sm ghost danger" data-prof-del="${esc(p.id)}">Delete</button>`}</div></div>`;
  }).join('');
  if ($('#prof-list').dataset.sig !== html) { $('#prof-list').innerHTML = html; $('#prof-list').dataset.sig = html; }
  $('#prof-now').textContent = 'Current settings: ' + Object.entries(r.current).map(([k, v]) => (PROF_LABELS[k] || k) + ' = ' + profValue(k, v)).join(', ');
}

async function exportDiagnostics() {
  const r = await call('/ui/diagnostics');
  const url = URL.createObjectURL(new Blob([r.text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = r.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('ok', 'Diagnostics saved as ' + r.filename);
}

$('#log-export').addEventListener('click', () => {
  const lines = logs.filter(logFilter()).map((l) => new Date(l.t).toISOString() + ' [' + l.level + '] ' + l.scope + ': ' + l.msg);
  if (!lines.length) return toast('info', 'Nothing to export with this filter');
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'manager-activity-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('ok', 'Exported ' + lines.length + ' lines');
});

// ============================================================ recent runs (Clients page)
let runsAt = 0;
async function renderRuns() {
  if (Date.now() - runsAt < 15000) return;
  runsAt = Date.now();
  try {
    const r = await call('/ui/runs?limit=12');
    const nm = (id) => { const a = accById(id); return a ? nameOf(a) : String(id); };
    const dur = (ms) => (ms >= 3600e3 ? (ms / 3600e3).toFixed(1) + ' h' : Math.max(1, Math.round(ms / 60e3)) + ' min');
    const kind = { closed: 'closed on purpose', disconnected: 'disconnected', exited: 'exited unexpectedly' };
    $('#runs-body').innerHTML = r.runs.length ? r.runs.map((x) => '<tr><td>' + esc(x.username || nm(x.accountId)) + '</td><td>' + new Date(x.endedAt).toLocaleString() + '</td><td>' + dur(x.uptimeMs) + '</td><td>' + (x.peakPrivMB ? (x.peakPrivMB / 1024).toFixed(2) + ' GB' : '') + '</td><td class="' + (x.kind === 'closed' ? '' : 'err') + '">' + esc(kind[x.kind] || x.kind) + (x.kind === 'closed' ? '' : ': ' + esc(x.reason)) + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">No finished runs recorded yet.</td></tr>';
  } catch { /* shown on next refresh */ }
}
setInterval(() => { if (S && !S.locked && $('#tab-clients').classList.contains('active')) renderRuns(); }, 5000);

// ============================================================ command palette (Ctrl+K) and page shortcuts (Alt+1..6)
const PAGES = [['clients', 'Clients'], ['accounts', 'Accounts'], ['servers', 'Servers'], ['logs', 'Activity'], ['experiments', 'Experiments'], ['settings', 'Settings']];
function paletteCommands() {
  const cmds = [];
  const add = (group, label, hint, fn) => cmds.push({ group, label, hint, fn });
  const ids = selIds();
  const need = (fn) => () => { if (!ids.length) throw new Error('Select accounts on the Accounts page first'); return fn(); };
  PAGES.forEach(([tab, label], i) => add('Go to', label, `Alt+${i + 1}`, () => showTab(tab)));
  add('Action', 'Add account', '', () => { showTab('accounts'); $('#btn-add').click(); });
  add('Action', 'Keyboard shortcuts', '?', () => openShortcuts());
  add('Action', ids.length ? `Launch ${ids.length} selected` : 'Launch selected', 'Enter', need(() => ACT.launch(ids)));
  add('Action', 'Stop selected', '', need(() => ACT.stop(ids)));
  add('Action', 'Restart selected', '', need(() => ACT.restart(ids)));
  add('Action', 'Keep-alive on for selected', '', need(() => ACT.keepAlive(ids, true)));
  add('Action', 'Keep-alive off for selected', '', need(() => ACT.keepAlive(ids, false)));
  add('Action', 'Select all accounts', 'Ctrl+A', () => { visibleAccounts().filter((a) => !a.main).forEach((a) => selected.add(a.id)); selectionChanged(); });
  add('Action', 'Clear selection', 'Esc', () => { selected.clear(); selectionChanged(); });
  add('Action', 'Close all clients (one by one)', '', () => { showTab('clients'); $('#fleet-close').click(); });
  add('Action', 'Tile Roblox windows', '', () => { showTab('accounts'); $('#btn-tile').click(); });
    add('Action', 'Free RAM on all clients (one by one)', '', () => { showTab('accounts'); $('#btn-trim').click(); });
  add('Action', 'Take a memory snapshot', '', () => { showTab('clients'); $('#fleet-snap').click(); });
  add('Action', 'Take a memory map', '', () => { showTab('clients'); $('#fleet-map').click(); });
  add('Action', 'Back up now', '', async () => { const b = await call('/ui/backups/create', {}); toast('ok', `Backup made: ${b.name}`); if (backupsCache) await refreshBackups(); });
  add('Action', 'Switch light / dark', '', () => $('#btn-theme').click());
  add('Action', 'Sidebar size: next', '', () => $('#btn-navsize').click());
  add('Action', 'Export activity log', '', () => { showTab('logs'); $('#log-export').click(); });
  add('Action', 'Export diagnostics', '', () => exportDiagnostics());
  for (const a of S.accounts) {
    const nm = nameOf(a);
    add('Account', nm, a.group && a.group !== 'Default' ? a.group : '', () => openDetails(a.id));
    add('Launch', nm, '', () => ACT.launch([a.id]));
  }
  return cmds;
}
function closePalette() {
  const p = $('#palette');
  if (!p) return;
  p.id = 'palette-closing';
  p.classList.add('closing');
  setTimeout(() => p.remove(), 130);
}
function openPalette() {
  closePalette();
  const cmds = paletteCommands();
  const o = document.createElement('div');
  o.id = 'palette'; o.className = 'palette-overlay';
  o.innerHTML = `<div class="palette" role="dialog" aria-label="Command palette"><input type="text" placeholder="Search pages, accounts and actions" autocomplete="off" spellcheck="false"><ul></ul><div class="foot"><span><span class="kbd">\u2191</span> <span class="kbd">\u2193</span> move</span><span><span class="kbd">Enter</span> run</span><span><span class="kbd">Esc</span> close</span></div></div>`;
  document.body.appendChild(o);
  const input = $('input', o), ul = $('ul', o);
  let shown = [], idx = 0;
  const paint = () => {
    ul.innerHTML = shown.length ? shown.map((c, i) => `<li data-i="${i}" class="${i === idx ? 'on' : ''}"><span class="g">${esc(c.group)}</span><span>${esc(c.label)}</span><span class="h">${esc(c.hint)}</span></li>`).join('') : '<li class="none">Nothing matches.</li>';
    $('li.on', ul)?.scrollIntoView({ block: 'nearest' });
  };
  const filter = () => {
    const toks = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = cmds.map((c) => { const hay = `${c.group} ${c.label} ${c.hint}`.toLowerCase(); return toks.every((t) => hay.includes(t)) ? { c, at: toks.length ? c.label.toLowerCase().indexOf(toks[0]) : 0 } : null; })
      .filter(Boolean).sort((a, b) => (a.at < 0) - (b.at < 0) || a.at - b.at).map((x) => x.c).slice(0, 40);
    idx = 0; paint();
  };
  const runCmd = (c) => {
    if (!c) return;
    closePalette();
    Promise.resolve().then(c.fn).catch((e) => toast('error', e.message));
  };
  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(shown[idx]); }
  });
  ul.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) runCmd(shown[Number(li.dataset.i)]); });
  o.addEventListener('mousedown', (e) => { if (e.target === o) closePalette(); });
  filter();
  input.focus();
}
$('#btn-palette').addEventListener('click', () => { if (S && !S.locked) openPalette(); });
