/** Espessura máxima de cada pilha (px). Reservar no estágio para não clipar. */
export const PAGE_STACK_MAX_PX = 20;
export const PAGE_STACK_PX_PER_PAGE = 0.4;

export type FlipbookPageStackCounts = {
  left: number;
  right: number;
};

/**
 * Páginas “atrás” de cada borda externa, alinhado a capa sozinha / miolo em par / contracapa.
 */
export function flipbookPageStackCounts(
  total: number,
  pageIndex: number,
): FlipbookPageStackCounts {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n <= 1) {
    return { left: 0, right: 0 };
  }
  const idx = Math.max(0, Math.min(n - 1, Math.floor(Number(pageIndex) || 0)));
  if (idx <= 0) {
    return { left: 0, right: n - 1 };
  }
  if (idx >= n - 1) {
    return { left: n - 1, right: 0 };
  }
  const leftIndex = idx % 2 === 1 ? idx : idx - 1;
  return {
    left: leftIndex,
    right: Math.max(0, n - (leftIndex + 2)),
  };
}

export function flipbookPageStackWidthPx(count: number): number {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return 0;
  return Math.min(PAGE_STACK_MAX_PX, n * PAGE_STACK_PX_PER_PAGE);
}
