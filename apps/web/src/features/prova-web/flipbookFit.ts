import type { ProvaWebPageMeta } from "@/api/provaWeb";

export const EAGER_BEFORE = 2;
export const EAGER_AFTER = 3;

/** Janela de páginas (+ capas) com src pronto para o primeiro paint. */
export function seedLoadedWindow(
  pages: ProvaWebPageMeta[],
  pageIndex: number,
  pageUrl: (page: ProvaWebPageMeta) => string,
): Record<number, string> {
  const total = pages.length;
  const next: Record<number, string> = {};
  if (total === 0) return next;

  const lo = Math.max(0, pageIndex - EAGER_BEFORE);
  const hi = Math.min(total - 1, pageIndex + EAGER_AFTER);
  for (let i = lo; i <= hi; i++) {
    const page = pages[i];
    if (!page) continue;
    next[page.page] = pageUrl(page);
  }
  for (const page of pages) {
    if (page.role === "cover-front" || page.role === "cover-back") {
      next[page.page] = pageUrl(page);
    }
  }
  return next;
}

/** Mescla mais páginas na janela (sticky — não remove URLs já vistas). */
export function mergeLoadedWindow(
  prev: Record<number, string>,
  pages: ProvaWebPageMeta[],
  pageIndex: number,
  pageUrl: (page: ProvaWebPageMeta) => string,
): Record<number, string> {
  const total = pages.length;
  if (total === 0) return prev;
  const next = { ...prev };
  let changed = false;
  const lo = Math.max(0, pageIndex - EAGER_BEFORE);
  const hi = Math.min(total - 1, pageIndex + EAGER_AFTER);
  for (let i = lo; i <= hi; i++) {
    const page = pages[i];
    if (!page || next[page.page]) continue;
    next[page.page] = pageUrl(page);
    changed = true;
  }
  for (const page of pages) {
    if (
      (page.role === "cover-front" || page.role === "cover-back") &&
      !next[page.page]
    ) {
      next[page.page] = pageUrl(page);
      changed = true;
    }
  }
  return changed ? next : prev;
}

/**
 * Tamanho de **uma** página para caber no estágio (contain).
 * `spread`: duas páginas lado a lado (largura útil = 2× pageW).
 */
export function computeFlipbookPageSize(args: {
  pageW: number;
  pageH: number;
  availW: number;
  availH: number;
  spread: boolean;
}): { width: number; height: number } {
  const pageW = Math.max(1, args.pageW);
  const pageH = Math.max(1, args.pageH);
  const availW = Math.max(1, args.availW);
  const availH = Math.max(1, args.availH);
  const needW = args.spread ? pageW * 2 : pageW;
  const needH = pageH;
  const scale = Math.min(1, availW / needW, availH / needH);
  return {
    width: Math.max(120, Math.round(pageW * scale)),
    height: Math.max(160, Math.round(pageH * scale)),
  };
}
