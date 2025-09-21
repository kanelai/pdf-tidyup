// Cache helpers for OS temp dir cache via main process IPC
// Merges values to avoid clobbering existing fields per key.
import type { PdfMeta, CacheEntry } from '../types/electron.js';

export function makeCacheKey(meta: PdfMeta): string {
  return `${meta.path}|${meta.mtimeMs}|${meta.size}`;
}

export async function getCache(key: string): Promise<CacheEntry | null> {
  try { 
    const result = await window.api.cacheGet(key);
    return result as CacheEntry | null;
  } catch { 
    return null; 
  }
}

export async function setCacheMerged(key: string, value: Partial<CacheEntry>): Promise<void> {
  try {
    const existing = await getCache(key);
    const merged = { ...(existing ?? {}), ...(value ?? {}) };
    await window.api.cacheSet(key, merged);
  } catch {
    // Ignore cache errors - they're not critical
  }
}

export async function computeAHashCached(meta: PdfMeta, computeAHashFn: (path: string) => Promise<bigint>): Promise<bigint> {
  const key = makeCacheKey(meta);
  const cached = await getCache(key);
  
  if (cached?.hash) {
    try {
      return BigInt(cached.hash);
    } catch {
      // Invalid cached hash, continue to compute new one
    }
  }
  
  const hash = await computeAHashFn(meta.path);
  try {
    await setCacheMerged(key, { hash: hash.toString() });
  } catch {
    // Cache write failed, but we still have the computed hash
  }
  
  return hash;
}
