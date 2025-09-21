const { contextBridge, ipcRenderer } = require('electron');

// Type definitions for the API
interface ConfirmOptions {
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  type?: 'info' | 'warning' | 'error' | 'question';
}

interface ConfirmResult {
  response: number;
  checkboxChecked?: boolean;
}

interface TrashResult {
  ok: boolean;
  results: TrashFileResult[];
}

interface TrashFileResult {
  path: string;
  ok: boolean;
  error?: string;
}

interface ElectronAPI {
  pickFolder: () => Promise<string | null>;
  listPdfs: (dirPath: string) => Promise<string[]>;
  listPdfsMeta: (dirPath: string) => Promise<any[]>;
  cacheGet: (key: string) => Promise<unknown>;
  cacheSet: (key: string, value: unknown) => Promise<boolean>;
  cacheClear: () => Promise<boolean>;
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
  trashFiles: (paths: string[]) => Promise<TrashResult>;
  revealInFolder: (paths: string[]) => Promise<boolean>;
  openFile: (path: string) => Promise<boolean>;
}

const api: ElectronAPI = {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  listPdfs: (dirPath: string) => ipcRenderer.invoke('list-pdfs', dirPath),
  listPdfsMeta: (dirPath: string) => ipcRenderer.invoke('list-pdfs-meta', dirPath),
  cacheGet: (key: string) => ipcRenderer.invoke('cache-get', key),
  cacheSet: (key: string, value: unknown) => ipcRenderer.invoke('cache-set', { key, value }),
  cacheClear: () => ipcRenderer.invoke('cache-clear'),
  confirm: (options: ConfirmOptions) => ipcRenderer.invoke('confirm', options),
  trashFiles: (paths: string[]) => ipcRenderer.invoke('trash-files', paths),
  revealInFolder: (paths: string[]) => ipcRenderer.invoke('reveal-in-folder', paths),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
};

contextBridge.exposeInMainWorld('api', api);
