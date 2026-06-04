'use strict';

const { app } = require('electron');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dev sem electron-updater */ }

let _push  = null;
let _wired = false;

function log(...args) { console.log('[updater]', ...args); }

// Categorize an error message so the UI can show a friendly, actionable text.
function classifyError(msg) {
  return /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|net::|getaddrinfo|request to .* failed|socket hang up|network/i.test(msg)
    ? 'network' : 'other';
}

function setupUpdater(pushFn) {
  _push = pushFn;
  if (!autoUpdater) { log('electron-updater indisponível — auto-update desativado.'); return; }
  if (_wired) return;
  _wired = true;

  autoUpdater.autoDownload         = false;   // user-initiated download (button)
  autoUpdater.autoInstallOnAppQuit = true;    // if downloaded, install on next quit
  autoUpdater.allowPrerelease      = false;

  autoUpdater.on('checking-for-update', () => {
    log('verificação iniciada · versão atual', app.getVersion());
    _push?.('update:status', { status: 'checking', currentVersion: app.getVersion() });
  });

  autoUpdater.on('update-available', info => {
    log('versão remota detectada:', info.version, '(atual', app.getVersion() + ')');
    _push?.('update:status', {
      status: 'available',
      currentVersion: app.getVersion(),
      version:        info.version,
      releaseDate:    info.releaseDate || null,
      releaseNotes:   typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log('já está na versão mais recente:', app.getVersion());
    _push?.('update:status', { status: 'upToDate', currentVersion: app.getVersion() });
  });

  autoUpdater.on('download-progress', p => {
    _push?.('update:progress', {
      percent:        Math.round(p.percent || 0),
      bytesPerSecond: p.bytesPerSecond || 0,
      transferred:    p.transferred || 0,
      total:          p.total || 0,
    });
  });

  autoUpdater.on('update-downloaded', info => {
    log('download concluído:', info.version);
    _push?.('update:status', { status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', err => {
    const msg = err?.message || String(err);
    log('erro:', msg);
    // Dev-mode noise (no dev-app-update.yml) — not a real error to surface
    if (msg.includes('dev-app-update') || msg.includes('ENOENT')) return;
    _push?.('update:status', { status: 'error', error: msg, kind: classifyError(msg) });
  });
}

// True only in a packaged build where auto-update can actually run.
function isAvailable() { return !!autoUpdater && app.isPackaged; }

async function checkForUpdates() {
  if (!autoUpdater)     return { ok: false, reason: 'unavailable' };
  if (!app.isPackaged)  return { ok: false, reason: 'dev' };   // electron-updater can't run in dev
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    log('checkForUpdates falhou:', e.message);
    return { ok: false, reason: 'error', error: e.message, kind: classifyError(e.message) };
  }
}

async function downloadUpdate() {
  if (!isAvailable()) return { ok: false };
  try {
    log('download iniciado');
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    log('downloadUpdate falhou:', e.message);
    _push?.('update:status', { status: 'error', error: e.message, kind: classifyError(e.message) });
    return { ok: false, error: e.message };
  }
}

function installUpdate() {
  if (!autoUpdater) return;
  try { log('instalando e reiniciando'); autoUpdater.quitAndInstall(); }
  catch (e) { log('installUpdate falhou:', e.message); }
}

module.exports = { setupUpdater, checkForUpdates, downloadUpdate, installUpdate, isAvailable };
