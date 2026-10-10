import path from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { loadEnv, logLine } from './env';
import { closeDb, getDb } from './db';
import { appRoot, databaseUrl } from './paths';
import { registerIpcHandlers, shutdownAutomation } from './ipc';
import { startScheduler, stopScheduler } from './services/scheduler';

loadEnv();
// Prisma reads DATABASE_URL when the client is constructed.
process.env.DATABASE_URL = databaseUrl();

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#070b14',
    title: 'InternPulse AI',
    show: false,
    webPreferences: {
      preload: path.join(appRoot(), 'dist', 'main', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void window.loadURL(devServer);
    // window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(appRoot(), 'dist', 'renderer', 'index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    try {
      await session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
        callback(allowed.has(permission));
      });

      registerIpcHandlers(() => mainWindow);
      await getDb();
      logLine(`[main] database ready at ${process.env.DATABASE_URL}`);

      mainWindow = createWindow();
      await startScheduler();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow();
        }
      });
    } catch (error) {
      logLine(`[main] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void (async () => {
      await stopScheduler();
      await shutdownAutomation();
      await closeDb();
    })();
  });
}
