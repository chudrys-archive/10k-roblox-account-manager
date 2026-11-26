'use strict';
// Generates assets/icon.ico (PNG-in-ICO, 256 + 48 + 32 + 24 + 16 px) and public/icon.png from public/logo.svg.
// The logo is drawn by headless Chrome/Edge (dev-time only; the committed .ico is what the build uses).
//   node tools/make-icon.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findBrowser } = require('../src/browser');

const ROOT = path.join(__dirname, '..');
const SIZES = [256, 48, 32, 24, 16];
const svg = fs.readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf8');
const browser = findBrowser('');
if (!browser) throw new Error('Chrome or Edge is needed to draw the icon.');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-icon-'));
function render(size) {
  const html = path.join(tmp, `i${size}.html`);
  const png = path.join(tmp, `i${size}.png`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(tmp, 'profile')}`, '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${png}`, 'file:///' + html.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 30000 });
  const buf = fs.readFileSync(png);
  if (buf.readUInt32BE(16) !== size || buf.readUInt32BE(20) !== size) throw new Error(`icon ${size}px rendered at the wrong size`);
  return buf;
}

const images = SIZES.map((s) => ({ size: s, data: render(s) }));
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const dir = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), Buffer.concat([head, ...dir, ...images.map((i) => i.data)]));
fs.writeFileSync(path.join(ROOT, 'public', 'icon.png'), images[0].data);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote assets/icon.ico and public/icon.png');
