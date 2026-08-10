/** Conversões e utilidades geométricas do Análise Lab (mm ↔ px). */

export const PT_TO_MM = 25.4 / 72;

export type EdgeKey = "top" | "right" | "bottom" | "left" | "all" | string;

export function ptToMm(pt: number): number {
  return Number(pt) * PT_TO_MM;
}

export function pageSizeMm(widthPt: number, heightPt: number): {
  widthMm: number;
  heightMm: number;
} {
  return {
    widthMm: ptToMm(Math.max(0, widthPt)),
    heightMm: ptToMm(Math.max(0, heightPt)),
  };
}

export function pxPerMm(displayedWidthPx: number, pageWidthMm: number): number {
  const wMm = Math.max(1e-6, pageWidthMm);
  return Math.max(0, displayedWidthPx) / wMm;
}

export function mmPerPx(displayedWidthPx: number, pageWidthMm: number): number {
  const px = Math.max(1e-6, displayedWidthPx);
  return Math.max(0, pageWidthMm) / px;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distanceMm(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function formatMm(value: number, digits = 1): string {
  return `${value.toFixed(digits)} mm`;
}

export function mirrorEdge(edge: EdgeKey): EdgeKey {
  if (edge === "left") return "right";
  if (edge === "right") return "left";
  return edge;
}

export interface MarkGeometryLike {
  edge?: string;
  offsetMm?: number;
  fromMm?: number;
  toMm?: number;
  xMm?: number;
  yMm?: number;
  wMm?: number;
  hMm?: number;
  x1Mm?: number;
  y1Mm?: number;
  x2Mm?: number;
  y2Mm?: number;
  stepMm?: number;
  [key: string]: number | string | undefined;
}

export interface MarkMirrorInput {
  pagina: number;
  espelhar?: boolean | null;
  paginaOrigem?: number | null;
  tipo: string;
  geometria: MarkGeometryLike;
}

/** Espelha geometria horizontalmente quando a paridade da página difere da origem. */
export function shouldMirrorMark(
  mark: MarkMirrorInput,
  pageNumber: number,
): boolean {
  if (mark.pagina !== 0 || !mark.espelhar) return false;
  const origem = Math.max(1, Number(mark.paginaOrigem) || 1);
  return pageNumber % 2 !== origem % 2;
}

export function resolveMarkGeometry(
  mark: MarkMirrorInput,
  pageNumber: number,
  pageWidthMm: number,
): MarkGeometryLike {
  const g = { ...mark.geometria };
  if (!shouldMirrorMark(mark, pageNumber)) return g;

  if (mark.tipo === "offset_corte" || mark.tipo === "faixa") {
    return { ...g, edge: mirrorEdge(String(g.edge || "top")) };
  }
  if (mark.tipo === "retangulo") {
    const x = Number(g.xMm) || 0;
    const w = Number(g.wMm) || 0;
    return {
      ...g,
      xMm: Math.max(0, pageWidthMm - x - w),
    };
  }
  if (mark.tipo === "ponto") {
    const x = Number(g.xMm) || 0;
    return { ...g, xMm: Math.max(0, pageWidthMm - x) };
  }
  if (mark.tipo === "medida") {
    const x1 = Number(g.x1Mm) || 0;
    const x2 = Number(g.x2Mm) || 0;
    return {
      ...g,
      x1Mm: Math.max(0, pageWidthMm - x1),
      x2Mm: Math.max(0, pageWidthMm - x2),
    };
  }
  return g;
}
