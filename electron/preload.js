const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getPlatform: () => process.platform,
  getAppVersion: () => require('../package.json').version,
  openPath: (dirPath) => ipcRenderer.invoke('open-path', dirPath),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, data) => cb(data)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, data) => cb(data)),
});
