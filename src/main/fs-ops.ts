import path from 'node:path';
import fs from 'node:fs';
import { shell } from 'electron';
import type { PdfMeta, TrashResult } from '../types/electron.js';

export function listPdfs(dirPath: string): string[] {
  if (!dirPath) return [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      .map(entry => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

export function listPdfsMeta(dirPath: string): PdfMeta[] {
  if (!dirPath) return [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: PdfMeta[] = [];
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stats = fs.statSync(fullPath);
          result.push({ path: fullPath, mtimeMs: stats.mtimeMs, size: stats.size });
        } catch {
          // Skip files we can't stat
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function trashFiles(paths: string[]): Promise<TrashResult> {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: true, results: [] };
  }
  
  const results = await Promise.all(
    paths.map(async (filePath) => {
      try {
        await shell.trashItem(filePath);
        return { path: filePath, ok: true };
      } catch (error) {
        return { path: filePath, ok: false, error: String(error) };
      }
    })
  );
  
  return { ok: results.every(r => r.ok), results };
}

export function revealInFolder(paths: string[]): boolean {
  if (!Array.isArray(paths)) return false;
  
  try {
    for (const filePath of paths) {
      try {
        shell.showItemInFolder(filePath);
      } catch {
        // Continue with other files even if one fails
      }
    }
    return true;
  } catch {
    return false;
  }
}
