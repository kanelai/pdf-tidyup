import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { CacheFile } from '../types/electron.js';

export const CACHE_DIR_NAME = 'pdf-catalog-cache';
export const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100MB

export function getCacheDir(): string {
  const dir = path.join(os.tmpdir(), CACHE_DIR_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory might already exist, ignore error
  }
  return dir;
}

export function encodeKeyToFilename(key: string): string {
  const b64 = Buffer.from(key, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function listCacheFiles(): CacheFile[] {
  const dir = getCacheDir();
  try {
    const names = fs.readdirSync(dir);
    return names
      .map(name => {
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          return st.isFile() ? { path: full, size: st.size, mtimeMs: st.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((file): file is CacheFile => file !== null);
  } catch {
    return [];
  }
}

export function enforceCacheLimit(): void {
  const files = listCacheFiles();
  let total = files.reduce((acc, f) => acc + f.size, 0);
  if (total <= MAX_CACHE_BYTES) return;
  
  // Sort by modification time (oldest first) for LRU eviction
  const sortedFiles = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  
  for (const file of sortedFiles) {
    try {
      fs.rmSync(file.path, { force: true });
      total -= file.size;
      if (total <= MAX_CACHE_BYTES) break;
    } catch {
      // Ignore individual file deletion errors
    }
  }
}

export function clearCacheDir(): void {
  const dir = getCacheDir();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore errors - cache clearing is best effort
  }
}
