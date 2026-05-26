'use strict';
/**
 * Generates build/icon-watcher.ico and build/icon-watcher.png for the watcher build.
 * Eye icon with teal accent — no external dependencies, Node built-ins only.
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

// ── Eye icon drawing ──────────────────────────────────────────
function drawEyeIcon(size) {
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

  // ── 2. Teal outer ring ───────────────────────────────────────
  const ringR = size / 2 - 2;
  const ringW = size * 0.035;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d >= ringR - ringW && d < ringR) {
        const blend = Math.min(1, Math.min(d - (ringR - ringW), ringR - d));
        setPixel(x, y, 0, 188, 212, Math.round(blend * 220)); // #00BCD4
      }
    }
  }

  // ── 3. Eye shape parameters ──────────────────────────────────
  const eRx = Math.round(82 * sc); // half-width of eye
  const eRy = Math.round(40 * sc); // half-height of eye

  // ── 3a. Dark shadow outline (slightly larger ellipse) ────────
  const sRx = eRx + Math.round(5 * sc);
  const sRy = eRy + Math.round(5 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const ev = (dx * dx) / (sRx * sRx) + (dy * dy) / (sRy * sRy);
      if (ev <= 1.0) {
        const alpha = ev < 0.8
          ? 190
          : Math.round(190 * (1 - (ev - 0.8) / 0.2));
        setPixel(x, y, 0, 28, 38, alpha);
      }
    }
  }

  // ── 3b. Eye whites ───────────────────────────────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const ev = (dx * dx) / (eRx * eRx) + (dy * dy) / (eRy * eRy);
      if (ev <= 1.0) {
        // Slightly bluish-white; edges marginally cooler
        const t     = Math.sqrt(ev);
        const alpha = ev < 0.88
          ? 255
          : Math.round(255 * (1 - (ev - 0.88) / 0.12));
        setPixel(x, y,
          Math.round(228 + t * 8),
          Math.round(232 + t * 5),
          Math.round(244 + t * 4),
          alpha);
      }
    }
  }

  // ── 4. Iris (teal gradient) ──────────────────────────────────
  const iR = Math.round(30 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < iR) {
        const t     = d / iR;
        const alpha = d < iR - 1 ? 255 : Math.round((iR - d) * 255);
        setPixel(x, y,
          0,
          Math.round(145 + t * 45),  // 145 → 190
          Math.round(185 - t * 25),  // 185 → 160
          alpha);
      }
    }
  }

  // ── 4a. Iris radial detail lines ─────────────────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const inner = Math.round(10 * sc);
      const outer = iR - Math.round(3 * sc);
      if (d > inner && d < outer) {
        const angle = Math.atan2(dy, dx);
        const v     = Math.abs(Math.sin(angle * 14));
        if (v < 0.18) {
          setPixel(x, y, 0, 80, 120, Math.round(28 * (1 - v / 0.18)));
        }
      }
    }
  }

  // ── 4b. Subtle upper-lid shadow on iris ──────────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < iR && dy < -Math.round(2 * sc)) {
        // Fade from top: darkest at very top, gone at middle
        const shade = Math.round(60 * (-dy / iR));
        setPixel(x, y, 0, 0, 0, shade);
      }
    }
  }

  // ── 5. Pupil ─────────────────────────────────────────────────
  const pR = Math.round(15 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < pR) {
        const alpha = d < pR - 1 ? 255 : Math.round((pR - d) * 255);
        setPixel(x, y, 4, 4, 10, alpha);
      }
    }
  }

  // ── 6. Specular highlight ─────────────────────────────────────
  const hlX = Math.round(cx - 9 * sc);
  const hlY = Math.round(cy - 9 * sc);
  const hlR = Math.round(7 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - hlX, dy = y - hlY;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < hlR) {
        const a = Math.round(215 * (1 - (d / hlR) ** 1.4));
        setPixel(x, y, 255, 255, 255, a);
      }
    }
  }

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
fs.mkdirSync(buildDir, { recursive: true });

const pixels = drawEyeIcon(256);
const png    = createPng(256, 256, pixels);

fs.writeFileSync(path.join(buildDir, 'icon-watcher.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon-watcher.ico'), pngToIco(png));
console.log('✅  build/icon-watcher.ico  (256px embedded PNG)');
console.log('✅  build/icon-watcher.png  (256px)');
