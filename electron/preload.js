const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getPlatform: () => process.platform,
  getAppVersion: () => ipcRenderer.sendSync('get-app-version'),
  openPath: (dirPath) => ipcRenderer.invoke('open-path', dirPath),
  // Mode management
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  switchMode: (mode) => ipcRenderer.invoke('switch-mode', mode),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  // Remote device connection
  openRemoteDevice: (url) => ipcRenderer.invoke('open-remote-device', url),
  hideMainWindow: () => ipcRenderer.invoke('hide-main-window'),
  showAbout: () => ipcRenderer.invoke('show-about'),
  // Auto-updater
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, data) => cb(data)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, data) => cb(data)),
});
