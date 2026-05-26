'use strict';
/**
 * Generates build/icon.ico and build/icon.png for electron-builder.
 * No external dependencies — uses only Node built-ins.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Pure-JS PNG encoder ───────────────────────────────────────
function createPng(width, height, rgbaPixels) {
  function crc32(buf) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcB  = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
    return Buffer.concat([len, typeB, data, crcB]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const ri = y * (1 + width * 4) + 1 + x * 4;
      raw[ri]     = rgbaPixels[pi];
      raw[ri + 1] = rgbaPixels[pi + 1];
      raw[ri + 2] = rgbaPixels[pi + 2];
      raw[ri + 3] = rgbaPixels[pi + 3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Icon drawing ──────────────────────────────────────────────
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Blend over current
    const srcA = a / 255;
    const dstA = px[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    px[i]     = Math.round((r * srcA + px[i]     * dstA * (1 - srcA)) / outA);
    px[i + 1] = Math.round((g * srcA + px[i + 1] * dstA * (1 - srcA)) / outA);
    px[i + 2] = Math.round((b * srcA + px[i + 2] * dstA * (1 - srcA)) / outA);
    px[i + 3] = Math.round(outA * 255);
  }

  // Background: dark navy circle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const r  = size / 2;
      if (d < r - 1) {
        const t = d / r;
        setPixel(x, y,
          Math.round(10  + t * 20),
          Math.round(10  + t * 15),
          Math.round(26  + t * 40),
          255
        );
      } else if (d < r) {
        // Anti-aliased edge → transparent
        const alpha = Math.round((r - d) * 255);
        setPixel(x, y, 10, 10, 26, alpha);
      }
    }
  }

  // Red outer ring
  const ringR = size / 2 - 2;
  const ringW = size * 0.035;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d >= ringR - ringW && d < ringR) {
        const blend = Math.min(1, Math.min(d - (ringR - ringW), ringR - d));
        setPixel(x, y, 192, 57, 43, Math.round(blend * 220));
      }
    }
  }

  // Sword: vertical blade
  const s = size / 256; // scale factor
  function fillRect(x, y, w, h, r, g, b, a = 255) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        setPixel(Math.round(x + dx), Math.round(y + dy), r, g, b, a);
  }

  // Scale relative to 256px icon
  const sc = size / 256;
  const blade_x  = Math.round(cx - 7 * sc);
  const blade_y  = Math.round(cy - 90 * sc);
  const blade_w  = Math.round(14 * sc);
  const blade_h  = Math.round(130 * sc);
  const guard_x  = Math.round(cx - 40 * sc);
  const guard_y  = Math.round(cy - 10 * sc);
  const guard_w  = Math.round(80 * sc);
  const guard_h  = Math.round(12 * sc);
  const grip_x   = Math.round(cx - 6 * sc);
  const grip_y   = Math.round(cy + guard_h + 2 * sc);
  const grip_w   = Math.round(12 * sc);
  const grip_h   = Math.round(50 * sc);
  const pommel_x = Math.round(cx - 12 * sc);
  const pommel_y = Math.round(grip_y + grip_h);
  const pommel_w = Math.round(24 * sc);
  const pommel_h = Math.round(18 * sc);

  // Blade (silver/white)
  fillRect(blade_x, blade_y, blade_w, blade_h, 220, 220, 230);
  // Blade edge highlight
  fillRect(blade_x + Math.round(2 * sc), blade_y, Math.round(3 * sc), blade_h, 255, 255, 255, 180);
  // Guard (gold)
  fillRect(guard_x, guard_y, guard_w, guard_h, 200, 160, 40);
  fillRect(guard_x, guard_y, guard_w, Math.round(3 * sc), 240, 200, 80, 200);
  // Grip (red)
  fillRect(grip_x, grip_y, grip_w, grip_h, 160, 30, 20);
  // Pommel (gold circle-ish)
  fillRect(pommel_x, pommel_y, pommel_w, pommel_h, 200, 160, 40);

  return px;
}

// ── ICO wrapper (PNG embedded, Windows Vista+) ────────────────
function pngToIco(pngBuf) {
  const header = Buffer.from([0, 0, 1, 0, 1, 0]); // reserved, type=1, count=1
  const entry  = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // width/height 0 = 256
  entry[2] = 0; entry[3] = 0; // colorCount, reserved
  entry.writeUInt16LE(1,  4);  // planes
  entry.writeUInt16LE(32, 6);  // bit count
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16,        12); // data offset
  return Buffer.concat([header, entry, pngBuf]);
}

// ── Main ──────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

for (const size of [256, 64, 32, 16]) {
  const pixels = drawIcon(size);
  const png    = createPng(size, size, pixels);
  if (size === 256) {
    fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), pngToIco(png));
    console.log('✅  build/icon.ico  (256px embedded PNG)');
    console.log('✅  build/icon.png  (256px)');
  }
}
