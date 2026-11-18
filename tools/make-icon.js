'use strict';
// Generates assets/icon.ico (PNG-in-ICO, 256 + 48 + 32 + 16 px) with no dependencies:
// charcoal->black rounded square with a white play triangle, matching the monochrome UI.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const c1 = [63, 63, 70], c2 = [9, 9, 11]; // charcoal -> near-black (monochrome theme)
  // play triangle (centered, slightly right for optical balance)
  const tx = [size * 0.38, size * 0.38, size * 0.74], ty = [size * 0.28, size * 0.72, size * 0.5];
  const inTri = (x, y) => {
    const d = (x1, y1, x2, y2) => (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2);
    const a = d(tx[0], ty[0], tx[1], ty[1]), b = d(tx[1], ty[1], tx[2], ty[2]), cc = d(tx[2], ty[2], tx[0], ty[0]);
    return !((a < 0 || b < 0 || cc < 0) && (a > 0 || b > 0 || cc > 0));
  };
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0, white = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        const qx = Math.max(r - fx, 0, fx - (size - r)), qy = Math.max(r - fy, 0, fy - (size - r));
        if (qx * qx + qy * qy <= r * r) { cover++; if (inTri(fx, fy)) white++; }
      }
      const t = (x + y) / (2 * size);
      const i = (y * size + x) * 4;
      const w = cover ? white / cover : 0;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round((c1[k] * (1 - t) + c2[k] * t) * (1 - w) + 255 * w);
      px[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [256, 48, 32, 16];
const images = sizes.map(png);
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length;
  return e;
});
const out = path.join(__dirname, '..', 'assets', 'icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, ...dir, ...images]));
fs.writeFileSync(path.join(__dirname, '..', 'public', 'icon.png'), images[0]);
console.log('wrote', out);
