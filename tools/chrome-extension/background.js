// Reads the Roblox login cookie only when the manager asks for it through the native host.
// The cookie is passed straight back over the native port. Nothing is stored here.
const HOST = 'com.isa.roblox_manager';
let port = null;

// Login starts on /login or /signup, but a successful sign-in moves the tab on to /home. So remember every tab that
// ever showed a login or sign-up page, and close those when the manager has the cookie. Closing the last tab closes
// its window.
const loginTabs = new Set();
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const u = info.url || (tab && tab.url) || '';
  if (/^https:\/\/www\.roblox\.com\/(login|signup)/.test(u)) loginTabs.add(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => loginTabs.delete(tabId));

async function closeLoginTabs() {
  const ids = [...loginTabs];
  loginTabs.clear();
  try {
    const open = await chrome.tabs.query({ url: ['https://www.roblox.com/login*', 'https://www.roblox.com/signup*'] });
    for (const t of open) if (!ids.includes(t.id)) ids.push(t.id);
  } catch (e) { /* no tab list */ }
  for (const id of ids) {
    try { await chrome.tabs.remove(id); } catch (e) { /* already closed */ }
  }
}

function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    return;
  }
  port.onMessage.addListener(async (msg) => {
    if (msg && msg.type === 'close') { closeLoginTabs(); return; }
    if (msg && msg.type === 'read') {
      let value = null;
      try {
        const c = await chrome.cookies.get({ url: 'https://www.roblox.com/', name: '.ROBLOSECURITY' });
        value = c && c.value ? c.value : null;
      } catch (e) {
        value = null;
      }
      try { port && port.postMessage({ type: 'cookie', value }); } catch (e) { /* host went away */ }
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
  });
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.onAlarm.addListener(connect);
chrome.alarms.create('iram-reconnect', { periodInMinutes: 1 });
connect();