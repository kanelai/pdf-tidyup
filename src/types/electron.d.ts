// Type definitions for Electron APIs used in this project

export interface ElectronAPI {
  pickFolder: () => Promise<string | null>;
  listPdfs: (dirPath: string) => Promise<string[]>;
  listPdfsMeta: (dirPath: string) => Promise<PdfMeta[]>;
  cacheGet: (key: string) => Promise<unknown>;
  cacheSet: (key: string, value: unknown) => Promise<boolean>;
  cacheClear: () => Promise<boolean>;
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
  trashFiles: (paths: string[]) => Promise<TrashResult>;
  revealInFolder: (paths: string[]) => Promise<boolean>;
  openFile: (path: string) => Promise<boolean>;
}

export interface PdfMeta {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface ConfirmOptions {
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  type?: 'info' | 'warning' | 'error' | 'question';
}

export interface ConfirmResult {
  response: number;
  checkboxChecked?: boolean;
}

export interface TrashResult {
  ok: boolean;
  results: TrashFileResult[];
}

export interface TrashFileResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface CacheFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface CacheEntry {
  hash?: string;
  thumbDataURL?: string;
  [key: string]: unknown;
}

export interface GridLayout {
  cols: number;
  cellW: number;
}

export interface GridLayoutOptions {
  gap?: number;
  gridPad?: number;
}

export interface RenderOptions {
  maxW: number;
  maxH: number;
}

export interface ContextMenuHandlers {
  onDelete?: () => Promise<void>;
  onReveal?: () => Promise<void>;
  onOpen?: () => Promise<void>;
}

export interface SelectionState {
  selected: Set<string>;
  listOrder: string[];
  lastIndex: number | null;
}

export interface HashEntry {
  path: string;
  h: bigint;
  size?: number;
  mtimeMs?: number;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
