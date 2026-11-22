'use strict';
const { logger, sleep } = require('./util');

const log = logger('captcha');

/**
 * Roblox FunCaptcha public keys.
 * VERIFY THESE on the actual build — intercept a login in Fiddler/Wireshark and
 * look for GET requests to roblox-api.arkoselabs.com/fc/gc/?id=<KEY>.
 * Keys rotate; the values below are starting points only.
 */
const ROBLOX_PK = {
  login:    'A2A14B1D-1AF3-C791-9BBC-EE33CC7A0A6F', // unverified — confirm per build
  signup:   'B7D8911C-5240-4C3E-AC64-F1EE6C7E2F72', // unverified
  follow:   '63E4117F-E727-42B4-6DAA-C8448B40D897', // unverified
};

class CaptchaError extends Error {}

// ── 2captcha ──────────────────────────────────────────────────────────────────

async function submit2captcha(apiKey, publicKey, pageUrl, blob) {
  const params = new URLSearchParams({
    key: apiKey, method: 'funcaptcha',
    publickey: publicKey, pageurl: pageUrl, json: '1',
  });
  if (blob) params.set('data[blob]', blob);
  const r = await fetch('https://2captcha.com/in.php', { method: 'POST', body: params });
  const body = await r.json();
  if (body.status !== 1) throw new CaptchaError(`2captcha submit: ${JSON.stringify(body)}`);
  return String(body.request);
}

async function poll2captcha(apiKey, taskId) {
  const r = await fetch(
    `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${taskId}&json=1`
  );
  const body = await r.json();
  if (body.status === 1) return body.request;         // token
  if (body.request === 'CAPCHA_NOT_READY') return null;
  throw new CaptchaError(`2captcha poll: ${JSON.stringify(body)}`);
}

async function balance2captcha(apiKey) {
  const r = await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=getbalance&json=1`);
  return (await r.json()).request;
}

// ── CapMonster ────────────────────────────────────────────────────────────────

async function submitCapmonster(apiKey, publicKey, pageUrl, blob) {
  const task = { type: 'FunCaptchaTaskProxyless', websiteURL: pageUrl, websitePublicKey: publicKey };
  if (blob) task.data = blob;
  const r = await fetch('https://api.capmonster.cloud/createTask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  });
  const body = await r.json();
  if (body.errorId !== 0) throw new CaptchaError(`CapMonster submit: ${JSON.stringify(body)}`);
  return String(body.taskId);
}

async function pollCapmonster(apiKey, taskId) {
  const r = await fetch('https://api.capmonster.cloud/getTaskResult', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, taskId: Number(taskId) }),
  });
  const body = await r.json();
  if (body.errorId !== 0) throw new CaptchaError(`CapMonster poll: ${JSON.stringify(body)}`);
  if (body.status === 'ready') return body.solution.token;
  return null;
}

async function balanceCapmonster(apiKey) {
  const r = await fetch('https://api.capmonster.cloud/getBalance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey }),
  });
  return (await r.json()).balance;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Solve a FunCaptcha challenge and return the token string.
 *
 * @param {object} config  { backend: '2captcha'|'capmonster', apiKey, timeoutSec, pollDelaySec }
 * @param {string} publicKey  The Arkose Labs public key (from ROBLOX_PK or live-captured)
 * @param {object} [opts]   { pageUrl, blob }
 */
async function solveFunCaptcha(config, publicKey, { pageUrl = 'https://www.roblox.com', blob = null } = {}) {
  const { backend, apiKey, timeoutSec = 120, pollDelaySec = 3 } = config;
  if (!apiKey) throw new CaptchaError('captcha.apiKey not configured');
  if (!backend || backend === 'none') throw new CaptchaError('captcha.backend not configured');

  log.info(`submitting FunCaptcha to ${backend} pk=${publicKey.slice(0, 8)}… blob=${blob ? 'yes' : 'no'}`);

  let taskId;
  switch (backend) {
    case '2captcha':  taskId = await submit2captcha(apiKey, publicKey, pageUrl, blob);  break;
    case 'capmonster': taskId = await submitCapmonster(apiKey, publicKey, pageUrl, blob); break;
    default: throw new CaptchaError(`unknown backend: ${backend}`);
  }

  log.info(`task ${taskId} submitted — polling every ${pollDelaySec}s (timeout ${timeoutSec}s)`);
  const deadline = Date.now() + timeoutSec * 1000;

  while (Date.now() < deadline) {
    await sleep(pollDelaySec * 1000);
    const token = backend === '2captcha'
      ? await poll2captcha(apiKey, taskId)
      : await pollCapmonster(apiKey, taskId);
    if (token) {
      log.info(`solved — token[:32]: ${token.slice(0, 32)}…`);
      return token;
    }
  }

  throw new CaptchaError(`captcha solve timed out after ${timeoutSec}s`);
}

/**
 * Check the account balance on the configured solving service.
 * Returns a number (USD) or null on failure.
 */
async function getBalance(config) {
  const { backend, apiKey } = config;
  if (!apiKey || !backend || backend === 'none') return null;
  try {
    const bal = backend === '2captcha' ? await balance2captcha(apiKey) : await balanceCapmonster(apiKey);
    return Number(bal);
  } catch { return null; }
}

module.exports = { solveFunCaptcha, getBalance, CaptchaError, ROBLOX_PK };
