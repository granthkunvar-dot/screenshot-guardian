const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  clipboard,
  globalShortcut,
  screen,
  Menu,
  Tray
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const screenshot = require('screenshot-desktop');

// Tesseract OCR worker (lazy init)
let tesseractWorker = null;
let tesseractReady = false;

let mainWindow = null;
let snipperWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0f14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    if (!fs.existsSync(iconPath)) return;
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('Screenshot Guardian — Win+S or Alt+S to Snip');

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Screenshot Guardian', enabled: false },
      { type: 'separator' },
      { label: '📸 Snip Screen (Win+S / Alt+S)', click: () => triggerSnip() },
      {
        label: 'Open Window',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
      } else {
        createWindow();
      }
    });
  } catch (err) {
    console.warn('Tray creation skipped:', err);
  }
}

// ── Inbuilt Screenshotter & Interactive Snipper ─────────────────────────
async function triggerSnip() {
  if (snipperWindow) return; // already active

  // Hide main window so it's not captured in screenshot
  const wasVisible = mainWindow && mainWindow.isVisible();
  if (wasVisible) {
    mainWindow.hide();
  }

  // Brief pause for window to vanish
  await new Promise(r => setTimeout(r, 160));

  try {
    const imgBuffer = await screenshot({ format: 'png' });
    const base64 = imgBuffer.toString('base64');
    openSnipperWindow(base64);
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

function openSnipperWindow(base64) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  snipperWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: true,
    resizable: false,
    movable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  snipperWindow.loadFile(path.join(__dirname, 'renderer', 'snipper.html'));

  snipperWindow.once('ready-to-show', () => {
    snipperWindow.show();
    snipperWindow.focus();
    snipperWindow.webContents.send('init-snip-image', { base64 });
  });

  snipperWindow.on('closed', () => {
    snipperWindow = null;
  });
}

ipcMain.on('trigger-snip', () => {
  triggerSnip();
});

ipcMain.on('snip-completed', (event, { base64 }) => {
  if (snipperWindow) {
    snipperWindow.close();
    snipperWindow = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('screenshot-loaded', {
    base64,
    name: 'snip_' + Date.now() + '.png',
    mimeType: 'image/png',
    size: Math.round(base64.length * 0.75),
    path: null,
  });
});

ipcMain.on('snip-canceled', () => {
  if (snipperWindow) {
    snipperWindow.close();
    snipperWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── Global Shortcuts Registration ───────────────────────────────────────
function registerShortcuts() {
  // Win+S (Super+S on Windows)
  try {
    const registeredWinS = globalShortcut.register('Super+S', () => {
      triggerSnip();
    });
    console.log('Registered Super+S (Win+S):', registeredWinS);
  } catch (e) {
    console.warn('Could not register Super+S:', e);
  }

  // Ctrl+Shift+S (Universal cross-app shortcut)
  try {
    const regCtrlShift = globalShortcut.register('CommandOrControl+Shift+S', () => {
      triggerSnip();
    });
    console.log('Registered CommandOrControl+Shift+S:', regCtrlShift);
  } catch (e) {
    console.warn('Could not register CommandOrControl+Shift+S:', e);
  }

  // Alt+S (Quick accessible fallback)
  try {
    const regAltS = globalShortcut.register('Alt+S', () => {
      triggerSnip();
    });
    console.log('Registered Alt+S:', regAltS);
  } catch (e) {
    console.warn('Could not register Alt+S:', e);
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ────────────────────────────────────────────────────────

// Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Screenshot',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  return {
    path: filePath,
    base64: data.toString('base64'),
    mimeType: getMimeType(filePath),
    name: path.basename(filePath),
    size: data.length,
  };
});

// Read image from clipboard
ipcMain.handle('read-clipboard-image', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const buffer = img.toPNG();
  return {
    path: null,
    base64: buffer.toString('base64'),
    mimeType: 'image/png',
    name: 'clipboard_image.png',
    size: buffer.length,
  };
});

// Copy blurred/safe image to clipboard
ipcMain.handle('copy-to-clipboard', async (event, { base64 }) => {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);
    return { success: true };
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    return { success: false, error: err.message };
  }
});

// Save blurred image to disk
ipcMain.handle('save-blurred-image', async (event, { base64, originalPath }) => {
  const defaultName = originalPath
    ? 'safe_' + path.basename(originalPath)
    : 'safe_screenshot.png';

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Safe Screenshot',
    defaultPath: path.join(os.homedir(), 'Desktop', defaultName),
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });
  if (result.canceled) return { success: false };
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(result.filePath, buffer);
  shell.showItemInFolder(result.filePath);
  return { success: true, filePath: result.filePath };
});

// OCR via Tesseract in main process
ipcMain.handle('ocr-recognize', async (event, { dataURL }) => {
  try {
    const { createWorker } = require('tesseract.js');
    if (!tesseractWorker) {
      tesseractWorker = await createWorker('eng', 1, {
        cachePath: path.join(app.getPath('userData'), 'tessdata'),
      });
      tesseractReady = true;
    }
    const result = await tesseractWorker.recognize(dataURL);
    const words = (result.data.words || []).map(w => ({
      text: w.text,
      bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
      confidence: w.confidence,
    }));
    const lines = (result.data.lines || []).map(l => ({
      text: l.text,
      bbox: { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 },
      confidence: l.confidence,
    }));
    return { text: result.data.text, words, lines, success: true };
  } catch (e) {
    console.error('OCR error:', e);
    return { text: '', words: [], lines: [], success: false, error: e.message };
  }
});

ipcMain.handle('ocr-status', async () => ({
  ready: tesseractReady,
  initialized: !!tesseractWorker,
}));

// Window controls
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  return map[ext] || 'image/png';
}
