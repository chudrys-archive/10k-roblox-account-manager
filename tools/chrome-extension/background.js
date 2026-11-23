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
chrome.tabs.onRemoved.addListener((tabId) => {
  // a login window closed by hand, before any cookie was captured: tell the manager to stop waiting for it
  if (!loginTabs.delete(tabId) || loginTabs.size) return;
  try { port && port.postMessage({ type: 'closed' }); } catch (e) { /* host went away */ }
});

async function closeLoginTabs() {
  // Signs Chrome out of Roblox by deleting only Chrome's copy of the cookie. The manager keeps its own copy and no logout request is sent, so that session stays valid.
  try { await chrome.cookies.remove({ url: 'https://www.roblox.com/', name: '.ROBLOSECURITY' }); } catch (e) { /* no cookie */ }
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

// Quick login: on the Roblox login tab, switch to the QR code and return it as a data URL. Runs only while a quick
// login is waiting. Nothing is kept here.
async function readQrImage() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.roblox.com/login*' });
    if (!tabs.length) return null;
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async () => {
        const img = document.querySelector('.cross-device-login-display-qr-code-image');
        if (!img) {
          const b = [...document.querySelectorAll('button')].find((x) => /qr code/i.test(x.innerText || ''));
          if (b) b.click();
          return null;
        }
        if (img.src.startsWith('data:')) return img.src;
        const blob = await (await fetch(img.src)).blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      },
    });
    return (r && r.result) || null;
  } catch (e) {
    return null;
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
    if (msg && msg.type === 'open') {
      // quick login: open the Roblox login page in a new window of this profile. The QR code is switched on there.
      const u = String(msg.url || '');
      if (/^https:\/\/www\.roblox\.com\/login/.test(u)) chrome.windows.create({ url: u, focused: true }).catch(() => {});
      return;
    }
    if (msg && msg.type === 'close') { closeLoginTabs(); return; }
    if (msg && msg.type === 'read') {
      let value = null;
      try {
        const c = await chrome.cookies.get({ url: 'https://www.roblox.com/', name: '.ROBLOSECURITY' });
        value = c && c.value ? c.value : null;
      } catch (e) {
        value = null;
      }
      let tabs = null;
      try { tabs = (await chrome.tabs.query({ url: 'https://www.roblox.com/*' })).length; } catch (e) { tabs = null; }
      try { port && port.postMessage({ type: 'cookie', value, tabs }); } catch (e) { /* host went away */ }
      if (msg && msg.qr) {
        const src = await readQrImage();
        if (src) { try { port && port.postMessage({ type: 'qr', src }); } catch (e) { /* host went away */ } }
      }
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