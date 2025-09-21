// Layout helpers: compute preview grid that fits within available area without scrolling
import type { GridLayout, GridLayoutOptions } from '../types/electron.js';

// Returns { cols, cellW }
export function computeGridLayout(
  containerRect: DOMRect, 
  n: number, 
  hpwList: number[], 
  options: GridLayoutOptions = {}
): GridLayout {
  const gap = options.gap ?? 12; // CSS gap between items
  const gridPad = options.gridPad ?? 16; // CSS padding of #previewGrid
  const maxW = Math.max(0, containerRect.width - 2 * gridPad);
  const maxH = Math.max(0, containerRect.height - 2 * gridPad);
  if (n === 0) return { cols: 0, cellW: 0 };

  let best = { cols: 1, cellW: maxW, fits: false, totalH: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const cellW = (maxW - gap * (cols - 1)) / cols;
    if (cellW <= 0) break;
    // Compute total height as sum of tallest row heights with current cellW
    let totalH = 0;
    for (let i = 0; i < n; i += cols) {
      const slice = hpwList.slice(i, i + cols);
      const rowH = Math.max(...slice.map(hpw => cellW * hpw));
      totalH += rowH;
      if (i + cols < n) totalH += gap;
    }
    const fits = totalH <= maxH;
    if (fits) {
      if (!best.fits || cellW > best.cellW) best = { cols, cellW, fits: true, totalH };
    } else if (!best.fits && totalH < best.totalH) {
      best = { cols, cellW, fits: false, totalH };
    }
  }
  if (!best.fits) {
    // Scale down uniformly to fit height
    const cols = best.cols;
    const cellW = best.cellW;
    let totalH = 0;
    for (let i = 0; i < n; i += cols) {
      const slice = hpwList.slice(i, i + cols);
      const rowH = Math.max(...slice.map(hpw => cellW * hpw));
      totalH += rowH;
      if (i + cols < n) totalH += gap;
    }
    const scale = totalH > 0 ? (maxH / totalH) : 1;
    return { cols: best.cols, cellW: cellW * scale };
  }
  return { cols: best.cols, cellW: best.cellW };
}
