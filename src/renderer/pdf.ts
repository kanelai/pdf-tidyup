// PDF utilities: centralizes pdfjs import, worker setup, and common helpers
// @ts-ignore - pdfjs-dist doesn't have proper TypeScript declarations
import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import type {RenderOptions} from '../types/electron.js';

// Point the worker to the ESM worker file inside node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const ratioCache = new Map<string, number>(); // path -> heightPerWidth for first page

// Reused offscreen canvas to avoid repeated allocations
const hashOffscreenCanvas = document.createElement('canvas');

// Compute a pHash (DCT-based perceptual hash) for robust similarity sorting.
// Steps: render -> grayscale -> downsample to 32x32 -> 2D DCT -> take 8x8 low freq (excluding DC)
// threshold by median -> 64-bit BigInt
export async function computePerceptualHash(filePath: string): Promise<bigint> {
  try {
    const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const target = 64; // render small; we'll resample to 32x32
    const scale = Math.min(target / baseViewport.width, target / baseViewport.height);
    const viewport = page.getViewport({ scale });
    const off = hashOffscreenCanvas;
    off.width = Math.max(1, Math.round(viewport.width));
    off.height = Math.max(1, Math.round(viewport.height));
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0n;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Downsample to 32x32 grayscale
    const size = 32;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = size;
    smallCanvas.height = size;
    const smallCtx = smallCanvas.getContext('2d');
    if (!smallCtx) return 0n;
    
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.drawImage(off, 0, 0, size, size);
    
    const imageData = smallCtx.getImageData(0, 0, size, size).data;
    const grayValues = new Float64Array(size * size);
    
    for (let i = 0; i < size * size; i++) {
      const r = imageData[i * 4] || 0;
      const g = imageData[i * 4 + 1] || 0;
      const b = imageData[i * 4 + 2] || 0;
      grayValues[i] = (r + g + b) / 3;
    }

    // 2D DCT (Discrete Cosine Transform)
    const dctCoeffs = new Float64Array(size * size);
    const alpha = new Float64Array(size);
    for (let u = 0; u < size; u++) {
      alpha[u] = (u === 0 ? Math.SQRT1_2 : 1);
    }
    
    // Precompute cosine table for efficiency
    const cosTable = Array.from({ length: size }, (_, u) => 
      new Float64Array(size).map((_, x) => 
        Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
      )
    );
    
    // DCT rows then columns (separable transform)
    const temp = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let u = 0; u < size; u++) {
        let sum = 0;
        for (let x = 0; x < size; x++) {
          sum += (grayValues[y * size + x] || 0) * (cosTable[u]?.[x] || 0);
        }
        temp[y * size + u] = (alpha[u] || 1) * sum;
      }
    }
    
    for (let u = 0; u < size; u++) {
      for (let v = 0; v < size; v++) {
        let sum = 0;
        for (let y = 0; y < size; y++) {
          sum += (temp[y * size + u] || 0) * (cosTable[v]?.[y] || 0);
        }
        dctCoeffs[v * size + u] = (alpha[v] || 1) * sum;
      }
    }

    // Extract top-left 8x8 block excluding DC component (0,0)
    const blockSize = 8;
    const coefficients: number[] = [];
    for (let v = 0; v < blockSize; v++) {
      for (let u = 0; u < blockSize; u++) {
        if (u === 0 && v === 0) continue; // Skip DC component
        coefficients.push(dctCoeffs[v * size + u] || 0);
      }
    }
    
    // Create hash using median threshold
    const sortedCoeffs = [...coefficients].sort((a, b) => a - b);
    const median = sortedCoeffs[Math.floor(sortedCoeffs.length / 2)] || 0;
    
    let hash = 0n;
    for (const coeff of coefficients) {
      hash = (hash << 1n) | (coeff > median ? 1n : 0n);
    }

    try { (page as any).cleanup && (page as any).cleanup(); } catch {}
    try { await pdf.destroy(); } catch {}

    return hash;
  } catch {
    return 0n;
  }
}

// Preferred similarity hash used for sorting; uses pHash and falls back to grayscale aHash on error
export async function computeVisualHash(filePath: string): Promise<bigint> {
  try {
    const h = await computePerceptualHash(filePath);
    if (h !== 0n) {
      return h;
    }
  } catch {}
  return await computeAverageHash(filePath);
}

async function computeAverageHash(filePath: string): Promise<bigint> {
  try {
    const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    
    const targetSize = 64;
    const scale = Math.min(targetSize / baseViewport.width, targetSize / baseViewport.height);
    const viewport = page.getViewport({ scale });
    
    const canvas = hashOffscreenCanvas;
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0n;
    
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    // Convert to grayscale and downsample to 8x8
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] || 0;
      const g = data[i + 1] || 0;
      const b = data[i + 2] || 0;
      const gray = Math.round((r + g + b) / 3);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    
    // Create 8x8 downsampled version
    const blockSize = 8;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = blockSize;
    smallCanvas.height = blockSize;
    const smallCtx = smallCanvas.getContext('2d');
    if (!smallCtx) return 0n;
    
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.drawImage(canvas, 0, 0, blockSize, blockSize);
    
    const smallImageData = smallCtx.getImageData(0, 0, blockSize, blockSize).data;
    const grayValues: number[] = [];
    let sum = 0;
    
    for (let i = 0; i < blockSize * blockSize; i++) {
      const gray = smallImageData[i * 4] || 0; // Already grayscale
      grayValues.push(gray);
      sum += gray;
    }
    
    const average = sum / (blockSize * blockSize);
    let hash = 0n;
    
    for (const gray of grayValues) {
      hash = (hash << 1n) | (gray >= average ? 1n : 0n);
    }
    
    try { (page as any).cleanup && (page as any).cleanup(); } catch {}
    try { await pdf.destroy(); } catch {}
    
    return hash;
  } catch {
    return 0n;
  }
}

export async function getHeightPerWidth(filePath: string): Promise<number> {
  if (ratioCache.has(filePath)) return ratioCache.get(filePath)!;
  try {
    const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const hpw = vp1.height / vp1.width;
    ratioCache.set(filePath, hpw);
    return hpw;
  } catch {
    const hpw = Math.SQRT2;
    ratioCache.set(filePath, hpw);
    return hpw;
  }
}

const pageCountCache = new Map<string, number>(); // path -> page count

export async function getPageCount(filePath: string): Promise<number> {
  if (pageCountCache.has(filePath)) return pageCountCache.get(filePath)!;
  try {
    const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    pageCountCache.set(filePath, pageCount);
    return pageCount;
  } catch {
    const pageCount = 1; // fallback to 1 page
    pageCountCache.set(filePath, pageCount);
    return pageCount;
  }
}

export async function renderFirstPageToCanvas(filePath: string, canvas: HTMLCanvasElement, { maxW, maxH }: RenderOptions): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / baseViewport.width, maxH / baseViewport.height);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    // Prefer JPEG to reduce memory/size; fallback to PNG if needed
      return await new Promise<string>((resolve) => {
        try {
            canvas.toBlob((blob) => {
                if (!blob) {
                    resolve(canvas.toDataURL('image/png'));
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.7);
        } catch {
            resolve(canvas.toDataURL('image/png'));
        }
    });
  } finally {
    // Clean up resources
    try { (page as any).cleanup && (page as any).cleanup(); } catch {}
    try { await pdf.destroy(); } catch {}
  }
}

export function drawDataURLToCanvas(dataURL: string, canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

export function drawDataURLToCanvasContain(dataURL: string, canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const imageWidth = img.naturalWidth;
      const imageHeight = img.naturalHeight;
      
      if (canvasWidth === 0 || canvasHeight === 0 || imageWidth === 0 || imageHeight === 0) {
        resolve();
        return;
      }
      
      const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
      const drawWidth = Math.round(imageWidth * scale);
      const drawHeight = Math.round(imageHeight * scale);
      const drawX = Math.floor((canvasWidth - drawWidth) / 2);
      const drawY = Math.floor((canvasHeight - drawHeight) / 2);
      
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      resolve();
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

// Export aliases for compatibility
export const computeAHash = computeVisualHash;

export { pdfjsLib };
