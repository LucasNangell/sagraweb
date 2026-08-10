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
