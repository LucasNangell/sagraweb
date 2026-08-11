import type { AnaliseLabMark } from "@/api/analiseLab";

import {
  resolveMarkGeometry,
  sangriaAllRects,
  type MarkGeometryLike,
} from "./analiseLabGeometry";
import { isMarkVisibleOnPage } from "./analiseLabPageSpec";

function distPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) {
    const a = px - x1;
    const b = py - y1;
    return Math.sqrt(a * a + b * b);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  const a = px - qx;
  const b = py - qy;
  return Math.sqrt(a * a + b * b);
}

function inRect(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  tol: number,
): boolean {
  return (
    x >= rx - tol &&
    x <= rx + rw + tol &&
    y >= ry - tol &&
    y <= ry + rh + tol
  );
}

function offsetHits(
  edge: string,
  offset: number,
  pageW: number,
  pageH: number,
  x: number,
  y: number,
  tol: number,
): boolean {
  if (edge === "top") return Math.abs(y - offset) <= tol;
  if (edge === "bottom") return Math.abs(y - (pageH - offset)) <= tol;
  if (edge === "left") return Math.abs(x - offset) <= tol;
  if (edge === "right") return Math.abs(x - (pageW - offset)) <= tol;
  return false;
}

function faixaHits(
  edge: string,
  from: number,
  to: number,
  pageW: number,
  pageH: number,
  x: number,
  y: number,
  tol: number,
): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (edge === "top") {
    return y >= lo - tol && y <= hi + tol && x >= -tol && x <= pageW + tol;
  }
  if (edge === "bottom") {
    const y0 = pageH - hi;
    const y1 = pageH - lo;
    return y >= y0 - tol && y <= y1 + tol && x >= -tol && x <= pageW + tol;
  }
  if (edge === "left") {
    return x >= lo - tol && x <= hi + tol && y >= -tol && y <= pageH + tol;
  }
  const x0 = pageW - hi;
  const x1 = pageW - lo;
  return x >= x0 - tol && x <= x1 + tol && y >= -tol && y <= pageH + tol;
}

function markHits(
  mark: AnaliseLabMark,
  g: MarkGeometryLike,
  pageNumber: number,
  pageW: number,
  pageH: number,
  x: number,
  y: number,
  tol: number,
): boolean {
  if (mark.tipo === "offset_corte") {
    const edge = String(g.edge || "top");
    const offset = Number(g.offsetMm) || 0;
    const edges = edge === "all" ? ["top", "right", "bottom", "left"] : [edge];
    return edges.some((e) => offsetHits(e, offset, pageW, pageH, x, y, tol));
  }
  if (mark.tipo === "faixa") {
    const edge = String(g.edge || "top");
    const from = Number(g.fromMm) || 0;
    const to = Number(g.toMm) || 0;
    const edges = edge === "all" ? ["top", "right", "bottom", "left"] : [edge];
    return edges.some((e) =>
      faixaHits(e, from, to, pageW, pageH, x, y, tol),
    );
  }
  if (mark.tipo === "sangria") {
    const edge = String(g.edge || "left");
    const from = Number(g.fromMm) || 0;
    const to = Number(g.toMm) || 0;
    if (edge === "all") {
      const rects = sangriaAllRects(
        Math.abs(from),
        pageW,
        pageH,
        pageW,
        pageH,
        1,
        1,
      );
      return rects.some((r) =>
        inRect(x, y, r.x, r.y, r.width, r.height, tol),
      );
    }
    const alongFrom = Number(g.alongFromMm) || 0;
    const alongTo = Number(g.alongToMm) || 0;
    // Sangria coords are negative outside paper; reuse faixa logic after mapping.
    if (edge === "top" || edge === "bottom") {
      return faixaHits(edge, from, to, pageW, pageH, x, y, tol) &&
        x >= Math.min(alongFrom, alongTo) - tol &&
        x <= Math.max(alongFrom, alongTo) + tol;
    }
    return faixaHits(edge, from, to, pageW, pageH, x, y, tol) &&
      y >= Math.min(alongFrom, alongTo) - tol &&
      y <= Math.max(alongFrom, alongTo) + tol;
  }
  if (mark.tipo === "retangulo") {
    return inRect(
      x,
      y,
      Number(g.xMm) || 0,
      Number(g.yMm) || 0,
      Number(g.wMm) || 0,
      Number(g.hMm) || 0,
      tol,
    );
  }
  if (mark.tipo === "circulo") {
    const cx = (Number(g.xMm) || 0) + (Number(g.wMm) || 0) / 2;
    const cy = (Number(g.yMm) || 0) + (Number(g.hMm) || 0) / 2;
    const rx = Math.max(0.5, (Number(g.wMm) || 0) / 2);
    const ry = Math.max(0.5, (Number(g.hMm) || 0) / 2);
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = Math.sqrt(nx * nx + ny * ny);
    return Math.abs(d - 1) <= tol / Math.min(rx, ry) || d <= 1;
  }
  if (mark.tipo === "ponto") {
    const dx = x - (Number(g.xMm) || 0);
    const dy = y - (Number(g.yMm) || 0);
    return Math.sqrt(dx * dx + dy * dy) <= Math.max(tol, 2);
  }
  if (mark.tipo === "medida" || mark.tipo === "seta") {
    return (
      distPointToSegment(
        x,
        y,
        Number(g.x1Mm) || 0,
        Number(g.y1Mm) || 0,
        Number(g.x2Mm) || 0,
        Number(g.y2Mm) || 0,
      ) <= tol
    );
  }
  if (mark.tipo === "texto") {
    const tx = Number(g.xMm) || 0;
    const ty = Number(g.yMm) || 0;
    const label = String(g.texto || mark.rotulo || "");
    const w = Math.max(8, label.length * 2.2);
    return inRect(x, y, tx, ty - 4, w, 6, tol);
  }
  if (mark.tipo === "livre") {
    const pts = Array.isArray(g.points) ? g.points : [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      if (
        distPointToSegment(
          x,
          y,
          Number(a[0]) || 0,
          Number(a[1]) || 0,
          Number(b[0]) || 0,
          Number(b[1]) || 0,
        ) <= tol
      ) {
        return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * Retorna o id da marca sob (xMm, yMm), ou null.
 * Empate: marca mais recente (maior id).
 */
export function hitTestMarkAt(args: {
  marks: AnaliseLabMark[];
  pageNumber: number;
  pageWidthMm: number;
  pageHeightMm: number;
  xMm: number;
  yMm: number;
  tolMm?: number;
}): number | null {
  const tol = Math.max(0.5, args.tolMm ?? 2);
  let best: AnaliseLabMark | null = null;
  for (const mark of args.marks) {
    if (!isMarkVisibleOnPage(mark, args.pageNumber)) continue;
    if (mark.tipo === "grade") continue;
    const g = resolveMarkGeometry(mark, args.pageNumber, args.pageWidthMm);
    if (
      !markHits(
        mark,
        g,
        args.pageNumber,
        args.pageWidthMm,
        args.pageHeightMm,
        args.xMm,
        args.yMm,
        tol,
      )
    ) {
      continue;
    }
    if (!best || mark.id > best.id) best = mark;
  }
  return best?.id ?? null;
}
