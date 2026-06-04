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
  const cx = size / 2, cy = size / 2;
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

  // Rounded-rectangle fill (axis-aligned), anti-aliased corners
  function fillRoundRect(x0, y0, w, h, rad, r, g, b) {
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
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // ── 1. Dark navy gradient background circle ──────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const R  = size / 2;
      if (d < R - 1) {
        const t = d / R;
        setPixel(x, y,
          Math.round(10 + t * 20),
          Math.round(10 + t * 15),
          Math.round(26 + t * 40),
          255);
      } else if (d < R) {
        setPixel(x, y, 10, 10, 26, Math.round((R - d) * 255));
      }
    }
  }

  // ── 2. Red outer ring — #C0392B ───────────────────────────────
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

  // ── 3. The letter "L" (vertical stem + bottom foot) ──────────
  const stroke = Math.round(34 * sc);          // stroke thickness
  const top    = Math.round(70 * sc);
  const bottom = Math.round(188 * sc);
  const left   = Math.round(96 * sc);
  const footW  = Math.round(82 * sc);
  const rad    = Math.round(5 * sc);

  // soft drop shadow for depth
  const off = Math.round(3 * sc);
  fillRoundRect(left + off, top + off, stroke, bottom - top, rad, 0, 0, 0); // stem shadow
  fillRoundRect(left + off, bottom - stroke + off, footW, stroke, rad, 0, 0, 0); // foot shadow

  // white letter
  fillRoundRect(left, top, stroke, bottom - top, rad, 240, 240, 244);       // vertical stem
  fillRoundRect(left, bottom - stroke, footW, stroke, rad, 240, 240, 244);  // bottom foot

  // subtle red accent highlight on the stem's left edge
  fillRoundRect(left, top, Math.round(5 * sc), bottom - top, 0, 230, 57, 70);

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
