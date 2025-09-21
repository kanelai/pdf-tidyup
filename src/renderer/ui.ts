// UI helpers: toast, progress HUD, and context menu
import type { ContextMenuHandlers } from '../types/electron.js';

const getToastEl = (): HTMLElement | null => document.getElementById('toast');
const progressEl = document.getElementById('thumbProgress') as HTMLProgressElement | null;
const progressTextEl = document.getElementById('thumbProgressText') as HTMLElement | null;
const getCtxMenuEl = (): HTMLElement | null => document.getElementById('ctxMenu');
const getCtxDeleteEl = (): HTMLElement | null => document.getElementById('ctxDelete');
const getCtxRevealEl = (): HTMLElement | null => document.getElementById('ctxReveal');
const getCtxOpenEl = (): HTMLElement | null => document.getElementById('ctxOpen');

let progressLabel = '';

export function showToast(kind: 'success' | 'error', message: string, timeout = 2000): void {
  const toastEl = getToastEl();
  if (!toastEl) return;
  
  toastEl.className = '';
  toastEl.classList.add(kind === 'error' ? 'error' : 'success');
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  
  setTimeout(() => {
    const el = getToastEl();
    if (el) el.style.display = 'none';
  }, timeout);
}

export function showProgress(total: number, label = ''): void {
  if (!progressEl || !progressTextEl) return;
  progressEl.style.display = total > 0 ? 'inline-block' : 'none';
  progressTextEl.style.display = total > 0 ? 'inline' : 'none';
  progressEl.max = 100;
  progressEl.value = 0;
  progressLabel = label;
  progressTextEl.textContent = (label ? label + ' ' : '') + '0%';
}

export function updateProgress(done: number, total: number): void {
  if (!progressEl || !progressTextEl || total === 0) return;
  
  const percentage = Math.round((done / total) * 100);
  progressEl.value = percentage;
  progressTextEl.textContent = `${progressLabel ? progressLabel + ' ' : ''}${percentage}%`;
}

export function hideProgress(): void {
  if (!progressEl || !progressTextEl) return;
  progressEl.style.display = 'none';
  progressTextEl.style.display = 'none';
}

let ctxMenuBound = false;

function ensureCtxMenuGlobalHide(): void {
  if (ctxMenuBound) return;
  
  document.addEventListener('click', () => {
    const menu = getCtxMenuEl();
    if (menu) menu.style.display = 'none';
  });
  
  document.addEventListener('contextmenu', (e) => {
    // Hide menu if right-click is outside our menu
    const menu = getCtxMenuEl();
    if (menu && !menu.contains(e.target as Node)) {
      menu.style.display = 'none';
    }
  });
  
  ctxMenuBound = true;
}

export function openContextMenu(x: number, y: number, handlers: ContextMenuHandlers): void {
  ensureCtxMenuGlobalHide();
  const ctxMenuEl = getCtxMenuEl();
  if (!ctxMenuEl) return;

  ctxMenuEl.style.left = `${x}px`;
  ctxMenuEl.style.top = `${y}px`;
  ctxMenuEl.style.display = 'block';

  // Wire up action handlers
  const deleteEl = getCtxDeleteEl();
  if (deleteEl) {
    deleteEl.onclick = async () => {
      const menu = getCtxMenuEl();
      if (menu) menu.style.display = 'none';
      if (handlers?.onDelete) await handlers.onDelete();
    };
  }

  const revealEl = getCtxRevealEl();
  if (revealEl) {
    revealEl.onclick = async () => {
      const menu = getCtxMenuEl();
      if (menu) menu.style.display = 'none';
      if (handlers?.onReveal) await handlers.onReveal();
    };
  }

  const openEl = getCtxOpenEl();
  if (openEl) {
    openEl.onclick = async () => {
      const menu = getCtxMenuEl();
      if (menu) menu.style.display = 'none';
      if (handlers?.onOpen) await handlers.onOpen();
    };
  }
}
