/** Utilitários de sincronia Inspeção ↔ Folhear. */

export function pageNumberToIndex(
  pages: Array<{ page: number }>,
  pageNumber: number,
): number {
  const idx = pages.findIndex((p) => p.page === pageNumber);
  if (idx >= 0) return idx;
  return Math.max(0, Math.min(pages.length - 1, pageNumber - 1));
}

/**
 * Em spread de duas páginas, a referência é a da esquerda (primeira visível).
 * Espelha a regra de resolveVisiblePages do flipbook.
 */
export function spreadLeftPage(
  pages: Array<{ page: number; role?: string }>,
  pageIndex: number,
): number {
  const total = pages.length;
  if (total === 0) return 1;
  if (pageIndex <= 0) return pages[0]!.page;
  if (pageIndex >= total - 1) return pages[total - 1]!.page;
  const left = pageIndex % 2 === 1 ? pageIndex : pageIndex - 1;
  return pages[left]?.page ?? pages[pageIndex]!.page;
}

export function clampPanelPosition(
  x: number,
  y: number,
  panelW: number,
  panelH: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewW - Math.max(80, panelW));
  const maxY = Math.max(0, viewH - Math.max(40, panelH));
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}
