const { app, BrowserWindow, Menu, Tray, dialog, shell, session, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { version } = require('../package.json');
const { initAutoUpdater, checkForUpdates } = require('./updater');

// ─── Linux /dev/shm Auto-Fix (MUST run before Electron initializes) ───
// Chromium child processes need working shared memory. Fix /dev/shm
// synchronously at module load time, BEFORE Chromium spawns any processes.
if (process.platform === 'linux') {
  const { execSync } = require('child_process');

  // Env var propagates to ALL child processes (more reliable than CLI flags)
  process.env.ELECTRON_DISABLE_SANDBOX = '1';

  let shmOk = false;
  try {
    const testFile = '/dev/shm/.neardrop-test-' + process.pid;
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    shmOk = true;
  } catch (e) {
    console.warn('[shm] /dev/shm is not accessible, attempting auto-fix...');
    try {
      execSync('pkexec sh -c "mkdir -p /dev/shm; mount -t tmpfs -o rw,nosuid,nodev,noexec,relatime,size=512M tmpfs /dev/shm 2>/dev/null; chmod 1777 /dev/shm"', {
        timeout: 30000,
        stdio: 'ignore',
      });
      console.log('[shm] /dev/shm fixed successfully');
      shmOk = true;
    } catch (fixErr) {
      console.warn('[shm] Could not auto-fix /dev/shm:', fixErr.message);
    }
  }

  // Chromium flags: sandbox off, GPU in main process (avoids child ESRCH crashes)
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-seccomp-filter-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}

// ─── State ───────────────────────────────────────────
let mainWindow = null;
let tray = null;
let serverInstance = null;
let isQuitting = false;
let serverPort = 51337;
let appMode = null; // 'host' | 'client'
const remoteWindows = new Set();

// ─── Settings Persistence ────────────────────────────
const settingsFile = path.join(app.getPath('userData'), 'neardrop-settings.json');
const stateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (data.mode === 'host' || data.mode === 'client') return data;
    }
  } catch (e) { /* corrupt — treat as first launch */ }
  return null;
}

function saveSettings(settings) {
  try {
    const existing = loadSettings() || {};
    const merged = { ...existing, ...settings };
    fs.writeFileSync(settingsFile, JSON.stringify(merged), 'utf8');
  } catch (e) { console.error('[settings] Save failed:', e.message); }
}

// ─── Window State Persistence ────────────────────────
function loadWindowState() {
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (e) { /* corrupt file */ }
  return { width: 1200, height: 800 };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(stateFile, JSON.stringify(bounds), 'utf8');
  } catch (e) { /* ignore */ }
}

// ─── Port Finding ────────────────────────────────────
async function findFreePort(startPort, endPort) {
  const net = require('net');
  for (let port = startPort; port <= endPort; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '0.0.0.0');
    });
    if (available) return port;
  }
  throw new Error(`No free port found between ${startPort} and ${endPort}`);
}

// ─── URL Validation ──────────────────────────────────
function isPrivateIP(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true; // CGNAT / Tailscale
  return false;
}

function normalizeUrl(raw) {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const parsed = new URL(url);
    if (!parsed.port) {
      parsed.port = '51337';
      url = parsed.toString().replace(/\/+$/, '');
    }
    return url;
  } catch (e) {
    return null;
  }
}

function isSelfUrl(url) {
  try {
    const parsed = new URL(url);
    const port = parseInt(parsed.port || '51337');
    if (port !== serverPort) return false;
    const { getLocalIPs } = require(path.join(__dirname, '..', 'src', 'utils'));
    const ips = getLocalIPs().map(ip => ip.address);
    return ips.includes(parsed.hostname);
  } catch (e) { return false; }
}

// ─── macOS App Menu ──────────────────────────────────
function createMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdates() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'NearDrop',
      submenu: [
        {
          label: appMode === 'client' ? 'Switch to Host Mode' : 'Switch to Client Mode',
          click: () => {
            const newMode = appMode === 'client' ? 'host' : 'client';
            saveSettings({ mode: newMode });
            app.relaunch();
            app.quit();
          }
        },
        { type: 'separator' },
        {
          label: 'Show Connect Window',
          click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
          visible: appMode === 'client'
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── System Tray ─────────────────────────────────────
function createTray() {
  let trayIcon;
  if (process.platform === 'darwin') {
    const trayPath = path.join(__dirname, 'trayTemplate.png');
    if (fs.existsSync(trayPath)) {
      trayIcon = nativeImage.createFromPath(trayPath);
      trayIcon.setTemplateImage(true);
    } else {
      const iconPath = path.join(__dirname, '..', 'public', 'icon', 'favicon-16x16.png');
      trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    }
  } else {
    const trayPath = path.join(__dirname, 'tray.png');
    if (fs.existsSync(trayPath)) {
      trayIcon = nativeImage.createFromPath(trayPath);
    } else {
      const iconPath = path.join(__dirname, '..', 'public', 'icon', 'favicon-32x32.png');
      trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    }
  }

  if (!trayIcon) return;

  tray = new Tray(trayIcon);
  tray.setToolTip('NearDrop');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  let menuItems;
  if (appMode === 'client') {
    menuItems = [
      {
        label: 'Show NearDrop',
        click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
      },
      { type: 'separator' },
      {
        label: 'Switch to Host Mode',
        click: () => { saveSettings({ mode: 'host' }); app.relaunch(); app.quit(); }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => { isQuitting = true; app.quit(); }
      }
    ];
  } else {
    const pin = serverInstance?.pinStore?.current || '----';
    const protocol = serverInstance?.config?.noTls ? 'http' : 'https';
    const { getLocalIPs } = require(path.join(__dirname, '..', 'src', 'utils'));
    const ips = getLocalIPs();
    const url = ips.length > 0 ? `${protocol}://${ips[0].address}:${serverPort}` : `${protocol}://localhost:${serverPort}`;

    menuItems = [
      {
        label: 'Show NearDrop',
        click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
      },
      { type: 'separator' },
      {
        label: `PIN: ${pin}`,
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(pin);
        }
      },
      {
        label: 'Copy URL',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(url);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => { isQuitting = true; app.quit(); }
      }
    ];
  }

  tray.setContextMenu(Menu.buildFromTemplate(menuItems));
}

// ─── Create Main Window ──────────────────────────────
function createWindow() {
  const windowState = loadWindowState();
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 500,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.platform !== 'linux',
    }
  });

  if (appMode === 'client') {
    mainWindow.loadFile(path.join(__dirname, 'client.html'));
  } else {
    const protocol = serverInstance?.config?.noTls ? 'http' : 'https';
    mainWindow.loadURL(`${protocol}://localhost:${serverPort}`);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (appMode === 'host') {
      mainWindow.webContents.executeJavaScript(`document.body.classList.add('electron')`);
    }
  });

  // Close behavior: host = minimize to tray, client = quit
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      if (appMode === 'host') {
        e.preventDefault();
        mainWindow.hide();
        if (process.platform === 'linux' && !tray) {
          mainWindow.minimize();
          mainWindow.show();
        }
      }
      // Client mode: just close (quit handled by window-all-closed)
    } else {
      saveWindowState();
    }
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // ─── Download Handling ─────────────────────────────
  session.defaultSession.on('will-download', (event, item) => {
    const suggestedName = item.getFilename();
    const downloadPath = dialog.showSaveDialogSync(mainWindow, {
      defaultPath: suggestedName,
    });
    if (downloadPath) {
      item.setSavePath(downloadPath);
    } else {
      item.cancel();
    }
  });

  // ─── External Link Guard ──────────────────────────
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (appMode === 'host') {
      const protocol = serverInstance?.config?.noTls ? 'http' : 'https';
      const serverUrl = `${protocol}://localhost:${serverPort}`;
      if (!url.startsWith(serverUrl)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Create Onboarding Window ────────────────────────
function createOnboardingWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 680,
    height: 580,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.platform !== 'linux',
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'onboarding.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// ─── Create Remote Device Window ─────────────────────
async function createRemoteWindow(url) {
  // Normalize
  const normalized = normalizeUrl(url);
  if (!normalized) return { error: 'Invalid URL format' };

  // Validate private IP
  try {
    const parsed = new URL(normalized);
    if (!isPrivateIP(parsed.hostname)) {
      return { error: 'URL must be a private/LAN IP address' };
    }
  } catch (e) {
    return { error: 'Invalid URL' };
  }

  // Self-connect check (host mode only)
  if (appMode === 'host' && isSelfUrl(normalized)) {
    return { error: 'Cannot connect to yourself' };
  }

  // Pre-validation ping
  try {
    const http = require(normalized.startsWith('https') ? 'https' : 'http');
    await new Promise((resolve, reject) => {
      const parsed = new URL(normalized);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/',
        method: 'HEAD',
        timeout: 3000,
        rejectAuthorized: false,
      }, (res) => resolve(res));
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  } catch (e) {
    return { error: `Could not reach ${normalized}. Make sure the host is running.` };
  }

  // Create window
  const isMac = process.platform === 'darwin';
  const parsed = new URL(normalized);
  const remoteWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: `NearDrop — ${parsed.hostname}:${parsed.port}`,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.platform !== 'linux',
      // NO preload — remote is untrusted
    }
  });

  // Accept self-signed certs for private IPs
  remoteWin.webContents.on('certificate-error', (event, url, error, cert, callback) => {
    try {
      const certUrl = new URL(url);
      if (isPrivateIP(certUrl.hostname)) {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch (e) { /* fall through */ }
    callback(false);
  });

  // Download handling for remote window
  remoteWin.webContents.session.on('will-download', (event, item) => {
    const suggestedName = item.getFilename();
    const downloadPath = dialog.showSaveDialogSync(remoteWin, {
      defaultPath: suggestedName,
    });
    if (downloadPath) {
      item.setSavePath(downloadPath);
    } else {
      item.cancel();
    }
  });

  // External links → system browser
  remoteWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });


  // Track
  remoteWindows.add(remoteWin);
  remoteWin.on('closed', () => {
    remoteWindows.delete(remoteWin);
    // In client mode, re-show main window when last remote closes
    if (appMode === 'client' && remoteWindows.size === 0 && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  remoteWin.loadURL(normalized);

  // Inject sidebar items after page loads
  remoteWin.webContents.on('did-finish-load', () => {
    const switchLabel = appMode === 'client' ? 'Switch to Host Mode' : 'Switch to Client Mode';
    remoteWin.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('neardrop-remote-section')) return;
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        
        // Add mode badge at top of sidebar
        const badge = document.createElement('div');
        const isClient = '${appMode}' === 'client';
        badge.textContent = isClient ? 'Client Mode' : 'Host Mode';
        const badgeColor = isClient ? '#ff9f43' : '#007aff';
        badge.style.cssText = 'margin:6px 12px 2px;padding:3px 10px;background:' + badgeColor + '22;border:1px solid ' + badgeColor + '44;border-radius:4px;font-size:10px;font-weight:600;color:' + badgeColor + ';text-transform:uppercase;letter-spacing:0.5px;text-align:center;';
        sidebar.insertBefore(badge, sidebar.firstChild);
        
        const section = document.createElement('div');
        section.id = 'neardrop-remote-section';
        section.className = 'sidebar-section';
        section.style.marginTop = 'auto';
        section.innerHTML = \`
          <div class="sidebar-header">REMOTE</div>
          <div class="sidebar-item" id="nd-switch-mode" style="cursor:pointer;">
            <svg class="sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            <span>${switchLabel}</span>
          </div>
          <div class="sidebar-item" id="nd-disconnect" style="cursor:pointer;">
            <svg class="sidebar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            <span>Disconnect</span>
          </div>
        \`;
        sidebar.appendChild(section);
        
        document.getElementById('nd-switch-mode').addEventListener('click', () => {
          location.href = 'neardrop://switch-mode';
        });
        document.getElementById('nd-disconnect').addEventListener('click', () => window.close());
      })();
    `).catch(() => {});
  });

  // Intercept neardrop:// protocol for mode switching
  remoteWin.webContents.on('will-navigate', (event, navUrl) => {
    if (navUrl === 'neardrop://switch-mode') {
      event.preventDefault();
      const newMode = appMode === 'client' ? 'host' : 'client';
      saveSettings({ mode: newMode });
      app.relaunch();
      isQuitting = true;
      app.quit();
      return;
    }
    // Allow same-origin navigation
    try {
      const navParsed = new URL(navUrl);
      const remoteParsed = new URL(normalized);
      if (navParsed.hostname !== remoteParsed.hostname || navParsed.port !== remoteParsed.port) {
        event.preventDefault();
        shell.openExternal(navUrl);
      }
    } catch (e) { /* allow */ }
  });

  return { success: true };
}

// ─── Windows Squirrel Events ─────────────────────────
if (process.platform === 'win32') {
  const cmd = process.argv[1];
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated' ||
      cmd === '--squirrel-uninstall' || cmd === '--squirrel-obsolete') {
    app.quit();
  }
}

// ─── Single Instance Lock (must be before whenReady) ─
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {

    // Set About panel
    app.setAboutPanelOptions({
      applicationName: 'NearDrop',
      applicationVersion: version,
      copyright: '© 2026 Prajeet Shrestha',
    });


    // ─── Read Settings ─────────────────────────────────
    const settings = loadSettings();

    if (!settings || !settings.mode) {
      // First launch — show onboarding
      appMode = null;
      createMenu();
      createOnboardingWindow();
    } else if (settings.mode === 'client') {
      // Client mode — no server
      appMode = 'client';
      createMenu();
      createWindow();
      createTray();

      // Auto-connect if there's a pending URL from host mode switch
      const pendingUrl = settings.pendingConnectUrl;
      if (pendingUrl) {
        saveSettings({ pendingConnectUrl: null });
        // Wait for window to be ready, then auto-connect
        mainWindow.once('ready-to-show', async () => {
          const result = await createRemoteWindow(pendingUrl);
          if (result && result.success) {
            mainWindow.hide();
          }
        });
      }
    } else {
      // Host mode — start server
      appMode = 'host';
      createMenu();

      try {
        serverPort = await findFreePort(51337, 51347);
      } catch (e) {
        dialog.showErrorBox('NearDrop', `Could not find a free port (51337-51347): ${e.message}`);
        app.quit();
        return;
      }

      try {
        const { startServer } = require(path.join(__dirname, '..', 'server.js'));
        serverInstance = await startServer({ port: serverPort, embedded: true, noTls: true });
      } catch (e) {
        dialog.showErrorBox('NearDrop', `Server failed to start: ${e.message}`);
        app.quit();
        return;
      }

      createWindow();
      createTray();

      // Update tray menu periodically (PIN might change)
      setInterval(updateTrayMenu, 5000);
    }

    // ─── IPC: App Version (sync) ─────────────────────
    ipcMain.on('get-app-version', (e) => {
      e.returnValue = app.getVersion();
    });

    // ─── IPC: Mode Management ──────────────────────────
    ipcMain.handle('set-mode', async (_, mode) => {
      if (mode !== 'host' && mode !== 'client') return { error: 'Invalid mode' };
      saveSettings({ mode });
      // Relaunch into chosen mode
      app.relaunch();
      app.quit();
    });

    ipcMain.handle('switch-mode', async (_, mode) => {
      if (mode !== 'host' && mode !== 'client') return { error: 'Invalid mode' };
      saveSettings({ mode });
      app.relaunch();
      app.quit();
    });

    ipcMain.handle('get-settings', async () => {
      return loadSettings() || {};
    });

    // ─── IPC: Remote Device ────────────────────────────
    ipcMain.handle('open-remote-device', async (_, url) => {
      if (appMode === 'host') {
        // Switch to client mode and relaunch with the target URL
        saveSettings({ mode: 'client', pendingConnectUrl: url });
        app.relaunch();
        isQuitting = true;
        app.quit();
        return { success: true, switching: true };
      }
      return createRemoteWindow(url);
    });

    // ─── IPC: Hide Main Window ──────────────────────────
    ipcMain.handle('hide-main-window', async () => {
      if (mainWindow) mainWindow.hide();
    });

    // ─── IPC: Show About ───────────────────────────────
    ipcMain.handle('show-about', async () => {
      app.showAboutPanel();
    });

    // ─── IPC: Open Directory (host mode) ───────────────
    ipcMain.handle('open-path', async (_, dirPath) => {
      if (appMode !== 'host' || !serverInstance) return;
      const os = require('os');
      const allowed = [
        serverInstance?.config?.dir,
        path.join(os.homedir(), '.neardrop'),
      ].filter(Boolean);
      if (!allowed.some(a => dirPath.startsWith(a))) return;
      return shell.openPath(dirPath);
    });

    // Initialize auto-updater
    initAutoUpdater(mainWindow);
  });
}

// Graceful shutdown
app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  if (serverInstance?.gracefulShutdown) {
    serverInstance.gracefulShutdown('Electron quit');
  }
  // Close all remote windows
  for (const win of remoteWindows) {
    try { win.close(); } catch (e) { /* ignore */ }
  }
});

app.on('window-all-closed', () => {
  if (appMode === 'client') {
    app.quit();
  }
  // Host mode: keep running in tray (macOS and others)
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── Crash Protection ────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // "Object has been destroyed" is a secondary crash from renderer dying —
  // don't scare the user with a dialog for it
  if (err.message && err.message.includes('Object has been destroyed')) return;
  try {
    dialog.showErrorBox('NearDrop Error', `An unexpected error occurred:\n${err.message}`);
  } catch (e) { /* dialog may fail during shutdown */ }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
