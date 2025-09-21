import {
    computeVisualHash,
    drawDataURLToCanvas,
    drawDataURLToCanvasContain,
    getHeightPerWidth as getHPWFromPdf,
    getPageCount,
    pdfjsLib,
    renderFirstPageToCanvas as renderFirstPageToCanvasPdf
} from './pdf.js';
import {computeGridLayout} from './layout.js';
import {computeAHashCached as computeAHashCachedShared, getCache, makeCacheKey, setCacheMerged} from './cache.js';
import {hideProgress, openContextMenu, showProgress, showToast, updateProgress} from './ui.js';
import {
    clearSelection,
    getSelectedPaths,
    handleItemClick,
    removePaths,
    selectSingle,
    setListOrder,
    updateListSelectionStyles as updateSelectionStyles
} from './selection.js';
import type {HashEntry, PdfMeta} from '../types/electron.js';

const pickBtn = document.getElementById('pickBtn') as HTMLButtonElement;
const sidebarEl = document.getElementById('sidebar') as HTMLElement;
const sidebarResizerEl = document.getElementById('sidebarResizer') as HTMLElement;
const thresholdSlider = document.getElementById('thresholdSlider') as HTMLInputElement;
const thresholdValue = document.getElementById('thresholdValue') as HTMLElement;
let hammingThreshold = Number(localStorage.getItem('hammingThreshold') || 8);
if (!Number.isFinite(hammingThreshold)) hammingThreshold = 8;
const folderPathEl = document.getElementById('folderPath') as HTMLElement;
const listEl = document.getElementById('list') as HTMLElement;
const clearCacheBtn = document.getElementById('clearCacheBtn') as HTMLButtonElement;
const selectedNameEl = document.getElementById('selectedName') as HTMLElement;
const canvasWrap = document.getElementById('canvasWrap') as HTMLElement;
const previewGrid = document.getElementById('previewGrid') as HTMLElement;
const columnsBadgeEl = document.getElementById('columnsBadge') as HTMLElement;

// Remove dynamic creation of thresholdWrap and slider
// Instead, set up event listeners and initial value for static elements
if (thresholdSlider && thresholdValue) {
  thresholdSlider.value = String(hammingThreshold);
  thresholdValue.textContent = String(hammingThreshold);
  thresholdSlider.addEventListener('input', () => {
    const val = Number(thresholdSlider.value);
    thresholdValue.textContent = String(val);
    localStorage.setItem('hammingThreshold', String(val));
    hammingThreshold = val;
    // Re-render grouping without rehashing
    if (lastSortedEntries && Array.isArray(lastSortedEntries)) {
      renderListGrouped(lastSortedEntries, hammingThreshold);
    }
  });
}

function renderListGrouped(entries: HashEntry[], hammingThreshold = 8): void {
  // Reorder existing items to preserve their canvases; create missing items if needed
  listEl.innerHTML = '';
  if (!entries || entries.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'No PDFs found in this folder.';
    listEl.appendChild(hint);
    return;
  }
  setListOrder(entries.map(e => e.path));
  const frag = document.createDocumentFragment();
  const makeSep = () => {
    const sep = document.createElement('div');
    sep.className = 'group-sep';
    sep.style.margin = '6px 0';
    sep.style.gridColumn = '1 / -1';
    sep.style.borderTop = '1px dashed #ddd';
    return sep;
  };
  // Build DOM in the new order, adding separators where needed
  let prevEntry: HashEntry | null = null;
  for (let i = 0; i < entries.length; i++) {
    const curr = entries[i]!;
    if (prevEntry && hamming(prevEntry.h, curr.h) > hammingThreshold) {
      frag.appendChild(makeSep());
    }
    // Try to reuse existing canvas/item if present
    let itemEl: HTMLElement | null = null;
    const canvas = thumbCanvasMap.get(curr.path);
    if (canvas) {
      itemEl = canvas.closest('.item') as HTMLElement;
    }
    if (!itemEl) {
      itemEl = createItem(curr.path);
      // Redraw from cache if available to avoid blanks for new items
      const cached = thumbCache.get(curr.path);
      if (cached) {
        const c = itemEl.querySelector('canvas') as HTMLCanvasElement;
        if (c) { drawDataURLToCanvas(cached, c).catch(() => {}); }
      }
    }
    frag.appendChild(itemEl);
    prevEntry = curr;
  }
  listEl.appendChild(frag);
}

function hamming(a: bigint, b: bigint): number {
  try {
    let x = (a ^ b);
    let count = 0;
    while (x) { count += Number(x & 1n); x >>= 1n; }
    return count;
  } catch { return 64; }
}

let currentDir: string | null = null;
let thumbCache = new Map<string, string>(); // path -> dataURL
let thumbCanvasMap = new Map<string, HTMLCanvasElement>(); // path -> thumbnail canvas element
let metaMap = new Map<string, PdfMeta>(); // path -> { path, mtimeMs, size }
let currentOpId = 0; // debouncing token for long-running folder ops
let lastSortedEntries: HashEntry[] | null = null; // remember last sorted list to re-group without rehashing

function setSelectedNameForSelection(): void {
  const count = getSelectedPaths().length;
  if (count === 0) {
    selectedNameEl.textContent = 'No file selected';
    selectedNameEl.title = '';
    if (columnsBadgeEl) columnsBadgeEl.style.display = 'none';
  } else if (count === 1) {
    const only = getSelectedPaths()[0];
    selectedNameEl.textContent = (only || '').split(/[\\/]/).pop() || '';
    selectedNameEl.title = only || '';
  } else {
    selectedNameEl.textContent = `${count} files selected`;
    selectedNameEl.title = `${count} files selected`;
  }
}

async function chooseFolder(): Promise<void> {
  if (!window.api) {
    console.error('window.api not available');
    return;
  }
  const opId = ++currentOpId;
  const dir = await window.api.pickFolder();
  if (!dir) return;
  if (opId !== currentOpId) return; // cancelled by newer action
  currentDir = dir; // string path
  folderPathEl.textContent = dir;
  folderPathEl.title = dir;
  const metas = await window.api.listPdfsMeta(dir);
  if (opId !== currentOpId) return;
  metaMap = new Map(metas.map(m => [m.path, m]));
  const sorted = await hashAndSortWithProgress(metas, opId);
  if (opId !== currentOpId) return;
  lastSortedEntries = sorted;
  renderListGrouped(sorted, hammingThreshold);
  await renderThumbnailsBatched(sorted.map(e => e.path), 4, opId);
  // clear selection and previews
  clearSelection();
  setSelectedNameForSelection();
  clearPreviewGrid();
}

if (pickBtn) {
  pickBtn.addEventListener('click', chooseFolder);
} else {
  console.error('pickBtn not found');
}

// Sidebar resizer: initialize and handlers
(function initSidebarResizer(){
  try {
    const storedW = Number(localStorage.getItem('sidebarWidthPx'));
    if (Number.isFinite(storedW) && storedW >= 220 && storedW <= window.innerWidth * 0.6) {
      sidebarEl.style.width = `${Math.round(storedW)}px`;
    }
  } catch {}
  if (!sidebarResizerEl || !sidebarEl) return;
  let dragging = false;
  let startX = 0;
  let startW = 0;
  const minW = 220;
  const maxW = Math.floor(window.innerWidth * 0.6);
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    let w = Math.max(minW, Math.min(maxW, startW + dx));
    sidebarEl.style.width = `${Math.round(w)}px`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // persist
    try {
      const w = parseInt(getComputedStyle(sidebarEl).width, 10);
      localStorage.setItem('sidebarWidthPx', String(w));
    } catch {}
  };
  sidebarResizerEl.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    startX = e.clientX;
    startW = sidebarEl.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    try {
      thumbCache.clear();
      metaMap.clear();
      if (currentDir) {
        const metas = await window.api.listPdfsMeta(currentDir);
        metaMap = new Map(metas.map(m => [m.path, m]));
        const sorted = await hashAndSortWithProgress(metas);
        lastSortedEntries = sorted;
        renderListGrouped(sorted, hammingThreshold);
        await renderThumbnailsBatched(sorted.map(e => e.path), 4);
      }
      showToast('success', 'Cache cleared');
    } catch {
      showToast('error', 'Failed to clear cache');
    }
  });
} else {
  console.error('clearCacheBtn not found');
}

function clearPreviewGrid(): void {
  previewGrid.innerHTML = '';
  previewGrid.classList.remove('multi');
}

function createItem(filePath: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 100; thumbCanvas.height = 140;
  thumb.appendChild(thumbCanvas);
  thumbCanvasMap.set(filePath, thumbCanvas);

  // Add page count display element
  const pageCountEl = document.createElement('div');
  pageCountEl.className = 'page-count';
  pageCountEl.textContent = '...'; // placeholder while loading
  thumb.appendChild(pageCountEl);

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = filePath.split(/[\\/]/).pop() || '';
  item.title = name.textContent;

  item.appendChild(thumb);
  item.appendChild(name);

  item.addEventListener('click', (e: MouseEvent) => {
    handleItemClick(filePath, { metaKey: e.metaKey || e.ctrlKey, shiftKey: e.shiftKey });
    updateSelectionStyles(listEl, thumbCanvasMap);
    setSelectedNameForSelection();
    renderSelectedPreviews().catch(() => {});
  });
  // Double-click to open PDF in OS default app
  item.addEventListener('dblclick', (e: MouseEvent) => {
    e.stopPropagation();
    if (window.api && typeof window.api.openFile === 'function') {
      window.api.openFile(filePath);
    }
  });

  return item;
}

async function updatePageCount(filePath: string): Promise<void> {
  try {
    const pageCount = await getPageCount(filePath);
    const canvas = thumbCanvasMap.get(filePath);
    if (canvas) {
      const pageCountEl = canvas.parentElement?.querySelector('.page-count') as HTMLElement;
      if (pageCountEl) {
        pageCountEl.textContent = `${pageCount}p`;
      }
    }
  } catch {
    // Ignore errors, keep placeholder
  }
}
function updateListSelectionStyles(): void { updateSelectionStyles(listEl, thumbCanvasMap); }

async function renderFirstPageToCanvas(filePath: string, canvas: HTMLCanvasElement, { maxW, maxH }: { maxW: number; maxH: number }): Promise<string> {
  const cached = thumbCache.get(filePath);
  if (cached) {
    await drawDataURLToCanvas(cached, canvas);
    return cached;
  }
  const url = await renderFirstPageToCanvasPdf(filePath, canvas, { maxW, maxH });
  thumbCache.set(filePath, url);
  return url;
}

async function renderPreviewIntoCanvas(filePath: string, canvas: HTMLCanvasElement, targetWidthCSS: number): Promise<void> {
  const loadingTask = pdfjsLib.getDocument({ url: `file://${filePath}` });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const vp1 = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const cellW = Math.max(0, targetWidthCSS);
  const scaleCSS = cellW / vp1.width;
  const scale = Math.min(scaleCSS * dpr, 3 * dpr);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  canvas.style.width = Math.round(viewport.width / dpr) + 'px';
  canvas.style.height = Math.round(viewport.height / dpr) + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const meta = metaMap.get(filePath);
    if (meta) {
      const key = makeCacheKey(meta);
      const cached = await getCache(key);
      if (cached && cached.thumbDataURL) {
        await drawDataURLToCanvasContain(cached.thumbDataURL, canvas);
      }
    }
  } catch {}

  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function renderSelectedPreviews(): Promise<void> {
  clearPreviewGrid();
  const paths = getSelectedPaths();
  if (paths.length === 0) return;
  if (paths.length > 1) previewGrid.classList.add('multi');
  const hpwList = await Promise.all(paths.map(p => getHPWFromPdf(p)));
  const wrapRect = canvasWrap.getBoundingClientRect();
  const layout = computeGridLayout(wrapRect, paths.length, hpwList);
  previewGrid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  if (columnsBadgeEl) {
    columnsBadgeEl.style.display = 'inline-block';
    const count = paths.length;
    columnsBadgeEl.textContent = `${count} selected`;
  }
  const frag = document.createDocumentFragment();
  for (const {} of paths) {
    const c = document.createElement('canvas');
    c.className = 'previewCanvas';
    frag.appendChild(c);
  }
  previewGrid.appendChild(frag);
  let i = 0;
  for (const p of paths) {
    const canvas = previewGrid.children[i++] as HTMLCanvasElement;
    try { await renderPreviewIntoCanvas(p, canvas, layout.cellW); } catch {}
  }
}

async function renderThumbnailsBatched(paths: string[], batchSize = 4, opId = currentOpId): Promise<void> {
  const total = Array.isArray(paths) ? paths.length : 0;
  if (total === 0) {
    hideProgress();
    return;
  }
  showProgress(total, 'Thumbnails');
  let done = 0;
  for (let i = 0; i < total; i += batchSize) {
    if (opId !== currentOpId) return; // cancelled
    const batch = paths.slice(i, i + batchSize);
    await Promise.all(batch.map(async (p) => {
      if (opId !== currentOpId) return; // cancelled
      const canvas = thumbCanvasMap.get(p);
      if (!canvas) { done++; return; }
      try {
        const meta = metaMap.get(p);
        if (meta) {
          const key = makeCacheKey(meta);
          const cached = await getCache(key);
          if (cached && cached.thumbDataURL) {
            await drawDataURLToCanvas(cached.thumbDataURL, canvas);
          } else {
            const url = await renderFirstPageToCanvas(p, canvas, { maxW: canvas.width, maxH: canvas.height });
            if (url) await setCacheMerged(key, { thumbDataURL: url });
          }
        } else {
          await renderFirstPageToCanvas(p, canvas, { maxW: canvas.width, maxH: canvas.height });
        }
        // Update page count asynchronously (don't wait for it)
        updatePageCount(p).catch(() => {});
      } catch { /* ignore */ }
      finally { done++; updateProgress(done, total); }
    }));
    // Yield between batches to allow GC and keep UI responsive
    await new Promise(r => setTimeout(r, 0));
  }
  setTimeout(hideProgress, 300);
}

// Compute and cache the visual hash (pHash with fallback), keyed by file path+mtime+size
async function computeVisualHashCached(meta: PdfMeta): Promise<bigint> {
  return await computeAHashCachedShared(meta, computeVisualHash);
}

async function hashAndSortWithProgress(metas: PdfMeta[], opId = currentOpId): Promise<HashEntry[]> {
  const total = Array.isArray(metas) ? metas.length : 0;
  if (total === 0) return [];
  showProgress(total, 'Hashing');
  let done = 0;
  const entries: HashEntry[] = [];
  const batchSize = 12; // micro-batch to yield periodically
  let sinceYield = 0;
  for (const m of metas) {
    if (opId !== currentOpId) return []; // cancelled
    const h = await computeVisualHashCached(m);
    entries.push({ path: m.path, h, size: m.size, mtimeMs: m.mtimeMs });
    done++;
    updateProgress(done, total);
    sinceYield++;
    if (sinceYield >= batchSize) {
      sinceYield = 0;
      // Yield to the event loop and GC
      await new Promise(r => setTimeout(r, 0));
    } else {
      await new Promise(requestAnimationFrame);
    }
  }
  entries.sort((a, b) => {
    if (a.h < b.h) return -1;
    if (a.h > b.h) return 1;
    if (a.size !== b.size) return (a.size || 0) - (b.size || 0);
    return (a.mtimeMs || 0) - (b.mtimeMs || 0);
  });
  return entries;
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderSelectedPreviews().catch(() => {});
  }, 150);
});

async function deleteSelectedWithConfirm(): Promise<void> {
  const paths = getSelectedPaths();
  const count = paths.length;
  if (count === 0) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: count === 1 ? 'Delete selected file?' : `Delete ${count} selected files?`,
    detail: count <= 10 ? paths.join('\n') : `${count} files will be moved to Trash.`,
  });
  if (res.response !== 0) return;
  const result = await window.api.trashFiles(paths);
  if (result && result.ok) {
    for (const p of paths) {
      const canvas = thumbCanvasMap.get(p);
      if (canvas) {
        const item = canvas.closest('.item') as HTMLElement;
        if (item && item.parentElement) item.parentElement.removeChild(item);
      }
      thumbCanvasMap.delete(p);
      thumbCache.delete(p);
      metaMap.delete(p);
    }
    removePaths(paths);
    setSelectedNameForSelection();
    await renderSelectedPreviews();
    showToast('success', count === 1 ? 'File moved to Trash' : 'Files moved to Trash');
  } else {
    showToast('error', 'Failed to delete some files');
  }
}

document.addEventListener('keydown', async (e: KeyboardEvent) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const deleteCombo = (isMac && e.metaKey && e.key === 'Backspace') || (!isMac && e.key === 'Delete');
  if (!deleteCombo) return;
  if (getSelectedPaths().length === 0) return;
  e.preventDefault();
  await deleteSelectedWithConfirm();
});

listEl.addEventListener('contextmenu', async (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation(); // prevent global contextmenu hide from immediately closing the menu
  let node: Element | null = e.target as Element;
  while (node && node !== listEl && !(node instanceof HTMLElement && node.classList.contains('item'))) {
    node = node.parentElement;
  }
  if (!node || node === listEl) return;
  const canvas = node.querySelector('canvas') as HTMLCanvasElement;
  let path: string | null = null;
  if (canvas) {
    for (const [p, c] of thumbCanvasMap.entries()) { if (c === canvas) { path = p; break; } }
  }
  if (!path) return;
  if (!getSelectedPaths().includes(path)) {
    selectSingle(path);
    updateListSelectionStyles();
    setSelectedNameForSelection();
    await renderSelectedPreviews();
  }
  openContextMenu(e.clientX, e.clientY, {
    onDelete: async () => { await deleteSelectedWithConfirm(); },
    onReveal: async () => {
      const paths = getSelectedPaths();
      if (paths.length === 0) return;
      try {
        const ok = await window.api.revealInFolder(paths);
        if (!ok) showToast('error', 'Failed to reveal in folder');
      } catch {
        showToast('error', 'Failed to reveal in folder');
      }
    },
    onOpen: async () => {
      const paths = getSelectedPaths();
      if (!paths.length || !paths[0]) return;
      try {
        const ok = await window.api.openFile(paths[0]!);
        if (!ok) showToast('error', 'Failed to open file');
      } catch {
        showToast('error', 'Failed to open file');
      }
    }
  });
});
