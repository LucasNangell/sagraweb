import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { itemOccurrences } from "./analiseLabComponente";
import {
  resolveMarkGeometry,
  type MarkGeometryLike,
} from "./analiseLabGeometry";
import { isMarkVisibleOnPage } from "./analiseLabPageSpec";

export interface BalloonAnchor {
  itemId: number;
  page: number;
  refNumber: number;
  xMm: number;
  yMm: number;
  hasMark: boolean;
  item: AnaliseLabItem;
  mark?: AnaliseLabMark | null;
}

export interface PackedBalloon extends BalloonAnchor {
  side: "left" | "right";
  topPx: number;
  bubbleX: number;
  bubbleY: number;
  anchorX: number;
  anchorY: number;
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

export function buildPageBalloons(args: {
  items: AnaliseLabItem[];
  marks: AnaliseLabMark[];
  pages: ProvaWebPageMeta[];
  visiblePages: ProvaWebPageMeta[];
  parsePageSpec: (spec: string) => number[];
  pageSizeMm: (
    widthPt: number,
    heightPt: number,
  ) => { widthMm: number; heightMm: number };
}): BalloonAnchor[] {
  const {
    items,
    marks,
    pages,
    visiblePages,
    parsePageSpec,
    pageSizeMm,
  } = args;
  const out: BalloonAnchor[] = [];
  let ref = 1;
  for (const pageMeta of visiblePages) {
    const { widthMm, heightMm } = pageSizeMm(
      pageMeta.widthPt || 0,
      pageMeta.heightPt || 0,
    );
    for (const item of items) {
      const occ = itemOccurrences(item, pages, parsePageSpec);
      if (!occ.includes(pageMeta.page)) continue;
      const linked = marks.find(
        (m) =>
          m.itemId === item.id && isMarkVisibleOnPage(m, pageMeta.page),
      );
      let xMm = widthMm * 0.88;
      let yMm = heightMm * 0.1;
      let hasMark = false;
      if (linked) {
        const a = markAnchorMm(linked, pageMeta.page, widthMm, heightMm);
        xMm = a.xMm;
        yMm = a.yMm;
        hasMark = true;
      }
      out.push({
        itemId: item.id,
        page: pageMeta.page,
        refNumber: ref,
        xMm,
        yMm,
        hasMark,
        item,
        mark: linked ?? null,
      });
      ref += 1;
    }
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
      { left: number; top: number; width: number; height: number; widthMm: number; heightMm: number }
    >;
    slotWidth: number;
  },
): PackedBalloon[] {
  const { stageHeight, balloonHeight, gap, pageRects, slotWidth } = opts;
  const bySide: Record<"left" | "right", BalloonAnchor[]> = {
    left: [],
    right: [],
  };
  for (const a of anchors) {
    const rect = pageRects[a.page];
    if (!rect) continue;
    const mid = rect.left + rect.width / 2;
    const side: "left" | "right" = mid < slotWidth / 2 ? "left" : "right";
    bySide[side].push(a);
  }

  const packed: PackedBalloon[] = [];
  for (const side of ["left", "right"] as const) {
    const list = bySide[side].slice().sort((a, b) => a.yMm - b.yMm);
    let cursor = 8;
    for (const a of list) {
      const rect = pageRects[a.page];
      if (!rect) continue;
      const anchorX = (a.xMm / Math.max(1, rect.widthMm)) * rect.width + rect.left;
      const anchorY =
        (a.yMm / Math.max(1, rect.heightMm)) * rect.height + rect.top;
      const desired = Math.max(8, Math.min(stageHeight - balloonHeight - 8, anchorY - balloonHeight / 2));
      const top = Math.max(cursor, desired);
      cursor = top + balloonHeight + gap;
      const bubbleX =
        side === "left" ? Math.max(4, rect.left - 220) : rect.left + rect.width + 8;
      packed.push({
        ...a,
        side,
        topPx: top,
        bubbleX,
        bubbleY: top,
        anchorX,
        anchorY,
      });
    }
  }
  return packed;
}
