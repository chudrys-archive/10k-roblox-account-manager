'use strict';

/**
 * Pure: turns the current settings and facts into a short list of things worth fixing before a long run.
 * Each item: { level: 'error' | 'warn' | 'info', id, text }. Nothing here is a hard limit; it only flags
 * combinations that are known to cause trouble in this manager or that the person chose explicitly.
 *   facts: { roblox: object|null, accounts: [{ username, status, keepAlive:{enabled} }], build: {changed, previous, current}|null, multiInstance: boolean }
 */
function preflight({ settings = {}, facts = {} } = {}) {
  const out = [];
  const add = (level, id, text) => out.push({ level, id, text });

  if (!facts.roblox) add('error', 'roblox-missing', 'Roblox was not found. Install it or set its path in Settings.');

  if (settings.customFFlags) {
    let ok = false;
    try { const v = JSON.parse(settings.customFFlags); ok = !!v && typeof v === 'object' && !Array.isArray(v); } catch { /* invalid */ }
    if (!ok) add('error', 'fflags-invalid', 'Extra FFlags is not a JSON object, so it is ignored on every launch.');
  }

  if (settings.graphicsApi === 'vulkan' || settings.graphicsApi === 'opengl') {
    add('warn', 'graphics-api', 'Graphics API is set to ' + (settings.graphicsApi === 'vulkan' ? 'Vulkan' : 'OpenGL') + '. This can crash or glitch on some GPUs and Roblox may ignore the flag. The Clients page shows what each client actually used once its log is read.');
  }

  if (facts.build && facts.build.changed) {
    add('warn', 'build-changed', 'Roblox updated from ' + facts.build.previous + ' to ' + facts.build.current + '. Memory baselines and growth rates from earlier runs may not apply.');
  }

  const bad = (facts.accounts || []).filter((a) => a.keepAlive && a.keepAlive.enabled && a.status && a.status !== 'valid');
  if (bad.length) add('warn', 'keepalive-invalid', 'Keep-alive is on for ' + bad.length + ' account(s) whose cookie is not valid: ' + bad.slice(0, 5).map((a) => a.username).join(', ') + (bad.length > 5 ? ', ...' : '') + '.');

  if (facts.multiInstance === false) add('info', 'single-instance', 'Only one Roblox client can run at a time. Turn on "Allow more than one Roblox client" to run several.');

  if (settings.watchdog && settings.watchdog.enabled === false) add('info', 'watchdog-off', 'Watchdog is paused, so keep-alive accounts will not be relaunched.');

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

module.exports = { preflight };
