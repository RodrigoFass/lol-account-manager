'use strict';

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dev mode sem electron-updater instalado */ }

let _push = null;

function setupUpdater(pushFn) {
  _push = pushFn;

  if (!autoUpdater) {
    console.log('[updater] electron-updater não disponível — auto-update desativado.');
    return;
  }

  autoUpdater.autoDownload          = true;
  autoUpdater.autoInstallOnAppQuit  = true;
  autoUpdater.allowPrerelease       = false;

  autoUpdater.on('checking-for-update', () => {
    _push?.('update:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', info => {
    _push?.('update:status', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    _push?.('update:status', { status: 'upToDate' });
  });

  autoUpdater.on('download-progress', progress => {
    _push?.('update:progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', info => {
    _push?.('update:status', { status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', err => {
    // Ignore common dev-mode errors silently
    const msg = err.message || '';
    if (!msg.includes('ENOENT') && !msg.includes('dev-app-update'))
      _push?.('update:status', { status: 'error', error: msg });
  });
}

function checkForUpdates() {
  if (!autoUpdater) return false;
  try { autoUpdater.checkForUpdates(); return true; } catch (e) { console.error('[updater]', e.message); return false; }
}

function installUpdate() {
  if (!autoUpdater) return;
  try { autoUpdater.quitAndInstall(); } catch (e) { console.error('[updater] installUpdate:', e.message); }
}

module.exports = { setupUpdater, checkForUpdates, installUpdate };
