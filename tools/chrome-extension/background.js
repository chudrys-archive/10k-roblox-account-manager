// Reads the Roblox login cookie only when the manager asks for it through the native host.
// The cookie is passed straight back over the native port. Nothing is stored here.
const HOST = 'com.isa.roblox_manager';
let port = null;

// Closes the roblox login / sign-up tab the manager just captured from. Closing the last tab closes its window.
async function closeLoginTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://www.roblox.com/login*', 'https://www.roblox.com/signup*'] });
    const ids = tabs.map((t) => t.id).filter((id) => id !== undefined);
    if (ids.length) await chrome.tabs.remove(ids);
  } catch (e) {
    /* already closed */
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