'use strict';
/**
 * Generates build/icon-watcher.ico, build/icon-watcher.png and
 * src/assets/icons/tray-watcher.png for the watcher build.
 *
 * Color scheme matches the app's existing reds:
 *   ring / accents : #C0392B  (192, 57, 43)  — same as main icon ring
 *   iris highlight : #E74C3C  (231, 76, 60)  — same as --danger CSS var
 *
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

  // ── 2. Red outer ring — #C0392B (192, 57, 43), same as main icon ──
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

  // ── 3. Eye shape parameters ──────────────────────────────────
  const eRx = Math.round(82 * sc); // half-width of eye
  const eRy = Math.round(40 * sc); // half-height of eye

  // ── 3a. Dark shadow outline (slightly larger ellipse, dark red-black) ──
  const sRx = eRx + Math.round(5 * sc);
  const sRy = eRy + Math.round(5 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const ev = (dx * dx) / (sRx * sRx) + (dy * dy) / (sRy * sRy);
      if (ev <= 1.0) {
        const alpha = ev < 0.8
          ? 200
          : Math.round(200 * (1 - (ev - 0.8) / 0.2));
        setPixel(x, y, 22, 4, 4, alpha);
      }
    }
  }

  // ── 3b. Eye whites (very slightly warm to match red theme) ───
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const ev = (dx * dx) / (eRx * eRx) + (dy * dy) / (eRy * eRy);
      if (ev <= 1.0) {
        const t     = Math.sqrt(ev);
        const alpha = ev < 0.88
          ? 255
          : Math.round(255 * (1 - (ev - 0.88) / 0.12));
        // Very pale warm white — barely pink at edges
        setPixel(x, y,
          Math.round(238 + t * 8),
          Math.round(228 + t * 4),
          Math.round(228 + t * 2),
          alpha);
      }
    }
  }

  // ── 4. Iris — red gradient ────────────────────────────────────
  // Center: dark crimson (100, 8, 8)
  // Edge:   app red #E74C3C (231, 76, 60)
  const iR = Math.round(30 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < iR) {
        const t     = d / iR;
        const alpha = d < iR - 1 ? 255 : Math.round((iR - d) * 255);
        setPixel(x, y,
          Math.round(100 + t * 131),  // 100 → 231
          Math.round(8   + t * 68),   //   8 → 76
          Math.round(8   + t * 52),   //   8 → 60
          alpha);
      }
    }
  }

  // ── 4a. Iris radial detail lines (dark red) ───────────────────
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
          setPixel(x, y, 60, 4, 4, Math.round(30 * (1 - v / 0.18)));
        }
      }
    }
  }

  // ── 4b. Upper-lid shadow on iris (adds depth) ─────────────────
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < iR && dy < -Math.round(2 * sc)) {
        const shade = Math.round(65 * (-dy / iR));
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
        setPixel(x, y, 4, 2, 2, alpha);
      }
    }
  }

  // ── 6. Specular highlight (warm white) ────────────────────────
  const hlX = Math.round(cx - 9 * sc);
  const hlY = Math.round(cy - 9 * sc);
  const hlR = Math.round(7 * sc);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - hlX, dy = y - hlY;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < hlR) {
        const a = Math.round(210 * (1 - (d / hlR) ** 1.4));
        setPixel(x, y, 255, 230, 225, a); // warm white
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
const trayDir  = path.join(__dirname, '..', 'src', 'assets', 'icons');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(trayDir,  { recursive: true });

const pixels = drawEyeIcon(256);
const png    = createPng(256, 256, pixels);

fs.writeFileSync(path.join(buildDir, 'icon-watcher.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon-watcher.ico'), pngToIco(png));
fs.writeFileSync(path.join(trayDir,  'tray-watcher.png'), png);

console.log('✅  build/icon-watcher.ico       (app icon — 256px)');
console.log('✅  build/icon-watcher.png       (app icon — 256px)');
console.log('✅  src/assets/icons/tray-watcher.png  (tray icon — 256px)');
