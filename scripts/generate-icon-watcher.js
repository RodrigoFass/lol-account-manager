'use strict';
/**
 * Generates build/icon-watcher.ico, build/icon-watcher.png and
 * src/assets/icons/tray-watcher.png for the app.
 *
 * Design: dark circle + red ring + a clean white "L" letter.
 * No external dependencies — Node built-ins only.
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
    const len   = Buffer.alloc(4); len.writeUInt32BE(data.length);
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
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const ri = y * (1 + width * 4) + 1 + x * 4;
      raw[ri] = rgbaPixels[pi]; raw[ri+1] = rgbaPixels[pi+1];
      raw[ri+2] = rgbaPixels[pi+2]; raw[ri+3] = rgbaPixels[pi+3];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── "L" icon drawing ──────────────────────────────────────────
function drawLetterIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const sc = size / 256;

  // Alpha-composite src over existing pixel
  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i   = (y * size + x) * 4;
    const sA  = a / 255;
    const dA  = px[i + 3] / 255;
    const oA  = sA + dA * (1 - sA);
    if (oA === 0) return;
    px[i]     = Math.round((r * sA + px[i]     * dA * (1 - sA)) / oA);
    px[i + 1] = Math.round((g * sA + px[i + 1] * dA * (1 - sA)) / oA);
    px[i + 2] = Math.round((b * sA + px[i + 2] * dA * (1 - sA)) / oA);
    px[i + 3] = Math.round(oA * 255);
  }

  // Rounded-rectangle fill (axis-aligned), anti-aliased corners.
  // baseA (0–255) scales the whole shape's opacity (for shadows/highlights).
  function fillRoundRect(x0, y0, w, h, rad, r, g, b, baseA = 255) {
    const x1 = x0 + w, y1 = y0 + h;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        // distance into the rounded corners
        let dx = 0, dy = 0;
        if (x < x0 + rad)      dx = (x0 + rad) - x;
        else if (x > x1 - rad) dx = x - (x1 - rad);
        if (y < y0 + rad)      dy = (y0 + rad) - y;
        else if (y > y1 - rad) dy = y - (y1 - rad);
        let a = 255;
        if (dx > 0 && dy > 0) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > rad) continue;
          if (d > rad - 1) a = Math.round(255 * (rad - d));
        }
        setPixel(x, y, r, g, b, Math.round(a * baseA / 255));
      }
    }
  }

  // Rounded-rectangle fill with a vertical color gradient (c0 top → c1 bottom).
  function fillRoundRectV(x0, y0, w, h, rad, c0, c1) {
    const x1 = x0 + w, y1 = y0 + h;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const t = h <= 0 ? 0 : Math.min(1, Math.max(0, (y - y0) / h));
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        let dx = 0, dy = 0;
        if (x < x0 + rad)      dx = (x0 + rad) - x;
        else if (x > x1 - rad) dx = x - (x1 - rad);
        if (y < y0 + rad)      dy = (y0 + rad) - y;
        else if (y > y1 - rad) dy = y - (y1 - rad);
        let a = 255;
        if (dx > 0 && dy > 0) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > rad) continue;
          if (d > rad - 1) a = Math.round(255 * (rad - d));
        }
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // ── The letter "L" — large, centered, brand red, transparent bg ──
  const stroke = Math.round(52 * sc);          // stroke thickness (bigger)
  const top    = Math.round(34 * sc);
  const bottom = Math.round(222 * sc);
  const left   = Math.round(62 * sc);
  const footW  = Math.round(132 * sc);
  const rad    = Math.round(9 * sc);

  // soft drop shadow for depth on light backgrounds (subtle)
  const off = Math.round(5 * sc);
  fillRoundRect(left + off, top + off, stroke, bottom - top, rad, 0, 0, 0, 55);            // stem shadow
  fillRoundRect(left + off, bottom - stroke + off, footW, stroke, rad, 0, 0, 0, 55);       // foot shadow

  // red L with a vertical gradient (lighter top → deeper brand red bottom)
  fillRoundRectV(left, top, stroke, bottom - top, rad, [232, 72, 84], [192, 40, 48]);      // vertical stem
  fillRoundRectV(left, bottom - stroke, footW, stroke, rad, [212, 56, 64], [188, 38, 46]); // bottom foot

  // subtle light highlight on the stem's left edge for a glossy finish
  fillRoundRect(left, top, Math.round(8 * sc), bottom - top, rad, 255, 150, 158, 95);

  return px;
}

// ── ICO wrapper (PNG embedded, Windows Vista+) ────────────────
function pngToIco(pngBuf) {
  const header = Buffer.from([0, 0, 1, 0, 1, 0]);
  const entry  = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1,  4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

// ── Main ──────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '..', 'build');
const trayDir  = path.join(__dirname, '..', 'src', 'assets', 'icons');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(trayDir,  { recursive: true });

const pixels = drawLetterIcon(256);
const png    = createPng(256, 256, pixels);

fs.writeFileSync(path.join(buildDir, 'icon-watcher.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon-watcher.ico'), pngToIco(png));
fs.writeFileSync(path.join(trayDir,  'tray-watcher.png'), png);

console.log('✅  build/icon-watcher.ico       (app icon "L" — 256px)');
console.log('✅  build/icon-watcher.png       (app icon "L" — 256px)');
console.log('✅  src/assets/icons/tray-watcher.png  (tray icon "L" — 256px)');
