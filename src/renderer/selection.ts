// Selection state and helpers for the sidebar list
import type { SelectionState } from '../types/electron.js';

const state: SelectionState = {
  selected: new Set(),
  listOrder: [],
  lastIndex: null,
};

export function setListOrder(paths: string[]): void {
  state.listOrder = Array.isArray(paths) ? [...paths] : [];
}

export function getSelectedPaths(): string[] {
  return [...state.selected];
}

export function clearSelection(): void {
  state.selected.clear();
  state.lastIndex = null;
}

export function removePaths(paths: string[]): void {
  for (const p of paths) state.selected.delete(p);
}

export function selectSingle(path: string): void {
  state.selected.clear();
  state.selected.add(path);
  state.lastIndex = state.listOrder.indexOf(path);
}

export function handleItemClick(path: string, { metaKey = false, shiftKey = false }: { metaKey?: boolean; shiftKey?: boolean } = {}): void {
  const currentIndex = state.listOrder.indexOf(path);
  
  if (shiftKey && state.lastIndex !== null && state.lastIndex >= 0 && currentIndex >= 0) {
    // Range selection
    const start = Math.min(state.lastIndex, currentIndex);
    const end = Math.max(state.lastIndex, currentIndex);
    const range = state.listOrder.slice(start, end + 1);
    
    if (!metaKey) {
      state.selected.clear();
    }
    range.forEach(p => state.selected.add(p));
  } else if (metaKey) {
    // Toggle selection
    if (state.selected.has(path)) {
      state.selected.delete(path);
    } else {
      state.selected.add(path);
    }
    state.lastIndex = currentIndex;
  } else {
    // Single selection
    state.selected.clear();
    state.selected.add(path);
    state.lastIndex = currentIndex;
  }
}

export function updateListSelectionStyles(listEl: HTMLElement, thumbCanvasMap: Map<string, HTMLCanvasElement>): void {
  const nodes = Array.from(listEl.children);
  
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !node.classList.contains('item')) {
      continue;
    }
    
    const canvas = node.querySelector('canvas');
    if (!canvas) continue;
    
    // Find the path for this canvas
    const foundPath = Array.from(thumbCanvasMap.entries())
      .find(([, c]) => c === canvas)?.[0] ?? null;
    
    if (foundPath && state.selected.has(foundPath)) {
      node.classList.add('selected');
    } else {
      node.classList.remove('selected');
    }
  }
}
