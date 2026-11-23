'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { logger } = require('./util');
const log = logger('capture-host');

const HOST_NAME = 'com.isa.roblox_manager';
// Stable id derived from the "key" in tools/chrome-extension/manifest.json.
const EXTENSION_ID = 'olgklphmjejfmlagcfnbeehodcembcmi';

/** Stable folder next to the data folder: the extension to load once, and the native host files. */
function captureBase(dataDir) {
  return path.join(path.dirname(dataDir), 'capture');
}

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p)) || null;
}

function copyFiles(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dst, f));
  }
}

function defaultRegAdd(key, value) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

/**
 * Copies the extension and native host to a stable folder, writes the host launcher and manifest, and
 * registers the host for the current user (HKCU, no admin). Safe to run on every start.
 */
async function registerCapture({ dataDir, nodePath = process.execPath, regAdd = defaultRegAdd } = {}) {
  const base = captureBase(dataDir);
  const extSrc = firstExisting([
    path.join(__dirname, '..', 'extension'),
    path.join(__dirname, '..', 'tools', 'chrome-extension'),
  ]);
  if (!extSrc) throw new Error('capture extension files not found');
  const extDir = path.join(base, 'extension');
  const hostDir = path.join(base, 'host');
  copyFiles(extSrc, extDir);
  fs.mkdirSync(hostDir, { recursive: true });
  const hostScript = path.join(hostDir, 'native-host.js');
  fs.copyFileSync(path.join(__dirname, 'native-host.js'), hostScript);

  const bat = path.join(hostDir, 'iram-capture-host.bat');
  fs.writeFileSync(bat, `@echo off\r\nset "IRAM_DATA_DIR=${dataDir}"\r\n"${nodePath}" "${hostScript}"\r\n`);

  const manifestPath = path.join(hostDir, HOST_NAME + '.json');
  const manifest = {
    name: HOST_NAME,
    description: 'Isa Roblox Account Manager login capture',
    path: bat,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  await regAdd(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, manifestPath);
  log.info('capture host registered');
  return { extDir, manifestPath };
}

module.exports = { registerCapture, captureBase, EXTENSION_ID };