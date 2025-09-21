import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {clearCacheDir, encodeKeyToFilename, enforceCacheLimit, getCacheDir} from './main/cache.js';
import {listPdfs, listPdfsMeta, revealInFolder, trashFiles} from './main/fs-ops.js';
import type {ConfirmOptions, ConfirmResult} from './types/electron.js';

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(process.cwd(), 'dist', 'preload.js')
    }
  });

  win.loadFile(path.join(process.cwd(), 'dist', 'index.html')).then(() => {});
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS keeps app alive; quit on non-darwin
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Open a folder picker and return selected directory path
ipcMain.handle('pick-folder', async (): Promise<string | null> => {
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0] || null;
});

// Given a directory, list absolute paths of .pdf files
ipcMain.handle('list-pdfs', async (_evt, dirPath: string): Promise<string[]> => listPdfs(dirPath));

// Given a directory, list absolute paths of .pdf files with metadata
ipcMain.handle('list-pdfs-meta', async (_evt, dirPath: string) => listPdfsMeta(dirPath));

// ---- Cache storage in OS temp dir (delegated to ./main/cache.js) ----

ipcMain.handle('cache-get', async (_evt, key: string): Promise<any> => {
  if (!key) return null;
  const file = path.join(getCacheDir(), encodeKeyToFilename(key) + '.json');
  try {
    if (!fs.existsSync(file)) return null;
    const txt = fs.readFileSync(file, 'utf8');
    // touch access time to implement LRU based on mtime
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {}
    return JSON.parse(txt);
  } catch {
    return null;
  }
});

ipcMain.handle('cache-set', async (_evt, payload: { key: string; value: any }): Promise<boolean> => {
  try {
    const { key, value } = payload || {};
    if (!key || typeof key !== 'string') return false;
    const file = path.join(getCacheDir(), encodeKeyToFilename(key) + '.json');
    fs.writeFileSync(file, JSON.stringify(value || {}), 'utf8');
    // enforce size limit with LRU eviction
    enforceCacheLimit();
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('cache-clear', async (): Promise<boolean> => {
  try {
    clearCacheDir();
    return true;
  } catch {
    return false;
  }
});

// listCacheFiles/enforceCacheLimit/clearCacheDir are in ./main/cache.js

// CLI: --clear-cache to wipe cache and exit
if (process.argv.includes('--clear_cache')) {
  try { clearCacheDir(); } catch {}
  // Exit without creating a window
  app.exit(0);
}

// ---- UI helpers IPC ----
ipcMain.handle('confirm', async (_evt, options: ConfirmOptions): Promise<ConfirmResult> => {
  // options: { message, detail, buttons, defaultId, cancelId, type }
  return await dialog.showMessageBox(win!, options || {});
});

ipcMain.handle('trash-files', async (_evt, paths: string[]) => trashFiles(paths));

ipcMain.handle('reveal-in-folder', async (_evt, paths: string[]) => revealInFolder(paths));

// Open a file in the OS default application
ipcMain.handle('open-file', async (_evt, filePath: string): Promise<boolean> => {
  try {
    if (!filePath) return false;
    const result = await shell.openPath(filePath);
    return result === '';
  } catch {
    return false;
  }
});
