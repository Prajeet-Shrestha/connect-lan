const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');

let mainWindow = null;
let isManualCheck = false;

function initAutoUpdater(win) {
  if (!app.isPackaged) return;
  mainWindow = win;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: v${info.version}`);
    // Send to renderer for in-app progress UI
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { version: info.version });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Already up to date');
    if (isManualCheck && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates',
        message: `You're up to date! (v${app.getVersion()})`,
        buttons: ['OK'],
      });
      isManualCheck = false;
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    console.log(`[updater] Download: ${pct}%`);
    // Dock/taskbar progress bar
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
      mainWindow.webContents.send('update-download-progress', {
        percent: pct,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    if (mainWindow) {
      // Clear dock/taskbar progress
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send('update-downloaded', { version: info.version });

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `v${info.version} has been downloaded. Restart to apply the update.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    if (mainWindow) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send('update-error', { message: err.message });
    }
    if (isManualCheck && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates. Please try again later.',
        detail: err.message,
        buttons: ['OK'],
      });
      isManualCheck = false;
    }
  });

  // Check for updates after a 5-second delay to avoid slowing startup
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[updater] Initial check failed:', err.message);
    });
  }, 5000);
}

function checkForUpdates() {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Development Mode',
      message: 'Auto-update is not available in development mode.',
      buttons: ['OK'],
    });
    return;
  }
  isManualCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] Manual check failed:', err.message);
    isManualCheck = false;
  });
}

module.exports = { initAutoUpdater, checkForUpdates };
