// Reads the Roblox login cookie only when the manager asks for it through the native host.
// The cookie is passed straight back over the native port. Nothing is stored here.
const HOST = 'com.isa.roblox_manager';
let port = null;

function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    return;
  }
  port.onMessage.addListener(async (msg) => {
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