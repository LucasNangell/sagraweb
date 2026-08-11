/** Fit e agrupamento de linhas do inspector (página simples/dupla). */

export type InspectorViewMode = "simples" | "dupla";

export interface FitPageSize {
  width: number;
  height: number;
}

export interface FitAvail {
  width: number;
  height: number;
}

const GUTTER_PX = 16;
const RULER_TOP_PX = 20;
const RULER_LEFT_PX = 24;
const PADDING_PX = 16;

export function fitZoom(
  pageOrRow: FitPageSize | FitPageSize[],
  avail: FitAvail,
  opts?: { max?: number; min?: number; gutterPx?: number },
): number {
  const max = opts?.max ?? 3;
  const min = opts?.min ?? 0.25;
  const gutter = opts?.gutterPx ?? GUTTER_PX;
  const pages = Array.isArray(pageOrRow) ? pageOrRow : [pageOrRow];
  if (!pages.length) return 1;
  const contentW =
    pages.reduce((sum, p) => sum + Math.max(1, p.width), 0) +
    gutter * Math.max(0, pages.length - 1) +
    RULER_LEFT_PX;
  const contentH =
    Math.max(...pages.map((p) => Math.max(1, p.height))) + RULER_TOP_PX;
  const availW = Math.max(40, avail.width - PADDING_PX * 2);
  const availH = Math.max(40, avail.height - PADDING_PX * 2);
  const z = Math.min(availW / contentW, availH / contentH);
  return Math.min(max, Math.max(min, z));
}

/** Agrupa páginas em linhas: simples = 1 por linha; dupla = 1ª isolada, depois pares. */
export function buildSpreadRows<T>(
  pages: T[],
  modo: InspectorViewMode,
): T[][] {
  if (!pages.length) return [];
  if (modo === "simples") {
    return pages.map((p) => [p]);
  }
  const rows: T[][] = [[pages[0]]];
  for (let i = 1; i < pages.length; i += 2) {
    const pair = pages.slice(i, i + 2);
    rows.push(pair);
  }
  return rows;
}

export function findRowIndexForPage<T extends { page: number }>(
  rows: T[][],
  pageNumber: number,
): number {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].some((p) => p.page === pageNumber)) return i;
  }
  return 0;
}

/**
 * Página ativa no scroll da inspeção.
 * - Linha = mais próxima do centro vertical.
 * - Na mesma linha (vista dupla), mantém a página atual se ainda estiver nela
 *   (clique na ímpar não é sobrescrito pelo par da esquerda).
 * - Ao entrar numa linha nova, usa a página da esquerda.
 */
export function resolveActivePageFromScroll<T extends { page: number }>(args: {
  rows: T[][];
  rowElements: Map<number, HTMLElement>;
  scrollTop: number;
  viewportHeight: number;
  currentPage?: number | null;
}): number | null {
  const { rows, rowElements, scrollTop, viewportHeight, currentPage } = args;
  if (!rows.length) return null;
  const mid = scrollTop + viewportHeight / 2;
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [idx, el] of rowElements) {
    if (idx >= rows.length) continue;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    const center = (top + bottom) / 2;
    const dist = mid >= top && mid <= bottom ? 0 : Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }
  const row = rows[bestIdx];
  if (!row?.length) return null;
  if (
    currentPage != null &&
    row.some((p) => p.page === currentPage)
  ) {
    return currentPage;
  }
  return row[0]?.page ?? null;
}

export const INSPECTOR_VIEW_STORAGE_KEY = "analise-lab:inspector-view";

export function loadInspectorViewMode(): InspectorViewMode {
  try {
    const raw = localStorage.getItem(INSPECTOR_VIEW_STORAGE_KEY);
    if (raw === "dupla" || raw === "simples") return raw;
  } catch {
    /* ignore */
  }
  return "simples";
}

export function saveInspectorViewMode(modo: InspectorViewMode): void {
  try {
    localStorage.setItem(INSPECTOR_VIEW_STORAGE_KEY, modo);
  } catch {
    /* ignore */
  }
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Zoom via Ctrl+scroll: fator exponencial baseado em deltaY. */
export function nextZoomFromWheel(
  zoom: number,
  deltaY: number,
  ctrlKey: boolean,
): number | null {
  if (!ctrlKey) return null;
  const factor = Math.exp(-deltaY * 0.0015);
  return clampZoom(zoom * factor);
}

export function zoomStep(zoom: number, dir: 1 | -1): number {
  const step = dir > 0 ? 1.1 : 1 / 1.1;
  return clampZoom(zoom * step);
}

export function anchorScrollAfterZoom(args: {
  scrollLeft: number;
  scrollTop: number;
  pointer: { x: number; y: number };
  oldZoom: number;
  newZoom: number;
}): { scrollLeft: number; scrollTop: number } {
  const { scrollLeft, scrollTop, pointer, oldZoom, newZoom } = args;
  if (oldZoom <= 0 || newZoom <= 0 || oldZoom === newZoom) {
    return { scrollLeft, scrollTop };
  }
  const ratio = newZoom / oldZoom;
  const contentX = scrollLeft + pointer.x;
  const contentY = scrollTop + pointer.y;
  return {
    scrollLeft: contentX * ratio - pointer.x,
    scrollTop: contentY * ratio - pointer.y,
  };
}

/** Primeira página da linha vizinha (←/→), ou null nos extremos. */
export function stepRowPage<T extends { page: number }>(
  rows: T[][],
  currentPage: number,
  dir: -1 | 1,
): number | null {
  if (!rows.length) return null;
  const idx = findRowIndexForPage(rows, currentPage);
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= rows.length) return null;
  const row = rows[nextIdx];
  return row?.[0]?.page ?? null;
}
