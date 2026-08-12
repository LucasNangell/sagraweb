import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { itemOccurrences } from "./analiseLabComponente";
import {
  resolveMarkGeometry,
  type MarkGeometryLike,
} from "./analiseLabGeometry";
import { isMarkVisibleOnPage } from "./analiseLabPageSpec";

export interface BalloonMarkAnchor {
  page: number;
  markId: number;
  xMm: number;
  yMm: number;
}

export interface BalloonAnchor {
  itemId: number;
  /** Página de referência para nav/ocorrências (primeira âncora ou primeira occ no viewport). */
  page: number;
  refNumber: number;
  hasMark: boolean;
  item: AnaliseLabItem;
  markAnchors: BalloonMarkAnchor[];
}

export interface PackedBalloon extends BalloonAnchor {
  side: "right";
  topPx: number;
  bubbleX: number;
  bubbleY: number;
  balloonWidth: number;
  leaders: Array<{
    markId: number;
    page: number;
    anchorX: number;
    anchorY: number;
  }>;
}

export function markAnchorMm(
  mark: AnaliseLabMark,
  pageNumber: number,
  widthMm: number,
  heightMm: number,
): { xMm: number; yMm: number } {
  const g = resolveMarkGeometry(
    {
      pagina: mark.pagina,
      espelhar: mark.espelhar,
      paginaOrigem: mark.paginaOrigem,
      tipo: mark.tipo,
      geometria: mark.geometria as MarkGeometryLike,
    },
    pageNumber,
    widthMm,
  );
  switch (mark.tipo) {
    case "ponto":
    case "texto":
      return { xMm: Number(g.xMm) || 0, yMm: Number(g.yMm) || 0 };
    case "retangulo":
    case "circulo":
      return {
        xMm: (Number(g.xMm) || 0) + (Number(g.wMm) || 0),
        yMm: Number(g.yMm) || 0,
      };
    case "seta":
    case "medida":
      return { xMm: Number(g.x2Mm) || 0, yMm: Number(g.y2Mm) || 0 };
    case "livre": {
      const pts = Array.isArray(g.points) ? g.points : [];
      const last = pts[pts.length - 1];
      return {
        xMm: Number(last?.[0]) || 0,
        yMm: Number(last?.[1]) || 0,
      };
    }
    case "offset_corte": {
      const edge = String(g.edge || "top");
      const offset = Number(g.offsetMm) || 0;
      if (edge === "left") return { xMm: offset, yMm: heightMm / 2 };
      if (edge === "right")
        return { xMm: Math.max(0, widthMm - offset), yMm: heightMm / 2 };
      if (edge === "bottom")
        return { xMm: widthMm / 2, yMm: Math.max(0, heightMm - offset) };
      return { xMm: widthMm / 2, yMm: offset };
    }
    case "faixa": {
      const edge = String(g.edge || "top");
      const from = Number(g.fromMm) || 0;
      const to = Number(g.toMm) || 0;
      const mid = (from + to) / 2;
      if (edge === "left" || edge === "right" || edge === "all") {
        const x = edge === "right" ? Math.max(0, widthMm - mid) : mid;
        return { xMm: x, yMm: heightMm / 2 };
      }
      if (edge === "bottom")
        return { xMm: widthMm / 2, yMm: Math.max(0, heightMm - mid) };
      return { xMm: widthMm / 2, yMm: mid };
    }
    default:
      return { xMm: widthMm * 0.85, yMm: heightMm * 0.12 };
  }
}

type PageSizeFn = (
  widthPt: number,
  heightPt: number,
) => { widthMm: number; heightMm: number };

function pageMetaSize(
  meta: ProvaWebPageMeta | undefined,
  pageSizeMm: PageSizeFn,
): { widthMm: number; heightMm: number } {
  return pageSizeMm(meta?.widthPt || 0, meta?.heightPt || 0);
}

/**
 * Páginas de navegação do balão: união do escopo do item com páginas das marcas.
 */
export function itemBalloonOccurrencePages(
  item: AnaliseLabItem,
  marks: AnaliseLabMark[],
  pages: ProvaWebPageMeta[],
  parsePageSpec: (spec: string) => number[],
): number[] {
  const set = new Set(itemOccurrences(item, pages, parsePageSpec));
  for (const mark of marks) {
    if (mark.itemId !== item.id) continue;
    if (mark.paginas?.trim()) {
      try {
        for (const n of parsePageSpec(mark.paginas)) {
          if (n >= 1) set.add(n);
        }
      } catch {
        /* ignore */
      }
    } else if (mark.pagina === 0) {
      for (const p of pages) {
        if (p.page >= 1) set.add(p.page);
      }
    } else if (mark.pagina >= 1) {
      set.add(mark.pagina);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Um balão por problema no viewport: congrega todas as marcas visíveis
 * nas páginas atuais (spread incluso).
 */
export function buildPageBalloons(args: {
  items: AnaliseLabItem[];
  marks: AnaliseLabMark[];
  pages: ProvaWebPageMeta[];
  visiblePages: ProvaWebPageMeta[];
  parsePageSpec: (spec: string) => number[];
  pageSizeMm: PageSizeFn;
}): BalloonAnchor[] {
  const {
    items,
    marks,
    pages,
    visiblePages,
    parsePageSpec,
    pageSizeMm,
  } = args;
  if (!visiblePages.length) return [];

  const visibleSet = new Set(visiblePages.map((p) => p.page));
  const out: BalloonAnchor[] = [];
  let ref = 1;

  for (const item of items) {
    const occ = itemOccurrences(item, pages, parsePageSpec);
    const occInView = occ.filter((n) => visibleSet.has(n));

    const markAnchors: BalloonMarkAnchor[] = [];
    for (const mark of marks) {
      if (mark.itemId !== item.id) continue;
      const pageOnView = visiblePages.find((p) =>
        isMarkVisibleOnPage(mark, p.page),
      );
      if (!pageOnView) continue;
      const { widthMm, heightMm } = pageMetaSize(pageOnView, pageSizeMm);
      const a = markAnchorMm(mark, pageOnView.page, widthMm, heightMm);
      markAnchors.push({
        page: pageOnView.page,
        markId: mark.id,
        xMm: a.xMm,
        yMm: a.yMm,
      });
    }

    if (!occInView.length && !markAnchors.length) continue;

    const refPage =
      markAnchors[0]?.page ??
      occInView[0] ??
      visiblePages[0]!.page;

    out.push({
      itemId: item.id,
      page: refPage,
      refNumber: ref,
      hasMark: markAnchors.length > 0,
      item,
      markAnchors,
    });
    ref += 1;
  }

  return out;
}

export function packBalloons(
  anchors: BalloonAnchor[],
  opts: {
    stageHeight: number;
    balloonHeight: number;
    gap: number;
    pageRects: Record<
      number,
      {
        left: number;
        top: number;
        width: number;
        height: number;
        widthMm: number;
        heightMm: number;
      }
    >;
    slotWidth: number;
    gutterRight?: number;
    balloonWidth?: number;
    heightsByItemId?: Record<number, number>;
  },
): PackedBalloon[] {
  const {
    stageHeight,
    balloonHeight,
    gap,
    pageRects,
    slotWidth,
    gutterRight = 280,
    balloonWidth,
    heightsByItemId,
  } = opts;
  const width = Math.max(
    180,
    balloonWidth ?? Math.max(180, gutterRight - 24),
  );

  const list = anchors.slice().sort((a, b) => {
    const ay = a.markAnchors[0]?.yMm ?? 0;
    const by = b.markAnchors[0]?.yMm ?? 0;
    return a.page - b.page || ay - by || a.itemId - b.itemId;
  });

  const packed: PackedBalloon[] = [];
  const usedHeights: number[] = [];
  let cursor = 8;
  for (const a of list) {
    const leaders: PackedBalloon["leaders"] = [];
    let sumY = 0;
    let countY = 0;

    for (const ma of a.markAnchors) {
      const rect = pageRects[ma.page];
      if (!rect) continue;
      const anchorX =
        (ma.xMm / Math.max(1, rect.widthMm)) * rect.width + rect.left;
      const anchorY =
        (ma.yMm / Math.max(1, rect.heightMm)) * rect.height + rect.top;
      leaders.push({
        markId: ma.markId,
        page: ma.page,
        anchorX,
        anchorY,
      });
      sumY += anchorY;
      countY += 1;
    }

    // Sem marcas: ainda precisa de um page rect para posicionar o box.
    const fallbackRect =
      pageRects[a.page] ??
      Object.values(pageRects)[0];
    if (!leaders.length && !fallbackRect) continue;

    const meanY =
      countY > 0
        ? sumY / countY
        : fallbackRect
          ? fallbackRect.top + fallbackRect.height * 0.12
          : 0;

    const h = heightsByItemId?.[a.itemId] ?? balloonHeight;
    const desired = Math.max(
      8,
      Math.min(stageHeight - h - 8, meanY - h / 2),
    );
    const top = Math.max(cursor, desired);
    cursor = top + h + gap;
    usedHeights.push(h);
    packed.push({
      ...a,
      side: "right",
      topPx: top,
      bubbleX: slotWidth + 12,
      bubbleY: top,
      balloonWidth: width,
      leaders,
    });
  }

  // Compact: se o stack extrapola o stage, sobe o conjunto preservando gaps.
  if (packed.length > 0) {
    const lastIdx = packed.length - 1;
    const lastBottom = packed[lastIdx]!.topPx + usedHeights[lastIdx]!;
    const overflow = lastBottom - (stageHeight - 8);
    if (overflow > 0) {
      const shift = Math.min(overflow, packed[0]!.topPx - 8);
      if (shift > 0) {
        for (const b of packed) {
          b.topPx -= shift;
          b.bubbleY -= shift;
        }
      }
    }
  }

  return packed;
}
