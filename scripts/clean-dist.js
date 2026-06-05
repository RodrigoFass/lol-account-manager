'use strict';
/**
 * Removes the build output folder (dist/) so a release starts from scratch.
 * Cross-platform (uses Node fs) — no rimraf/rd dependency.
 */
const fs   = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('🧹  dist/ removida — build limpo.');
} else {
  console.log('✨  dist/ já não existe — nada a limpar.');
}
