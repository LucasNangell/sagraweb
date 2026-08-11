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

/** Converte intervalo absoluto na página (xMin/xMax ou yMin/yMax) em De/Até a partir da borda. */
export function faixaFromDrag(
  edge: EdgeKey,
  aMm: number,
  bMm: number,
  pageWidthMm: number,
  pageHeightMm: number,
): { fromMm: number; toMm: number } | null {
  const lo = Math.min(aMm, bMm);
  const hi = Math.max(aMm, bMm);
  if (hi - lo < 0.5) return null;
  const e = String(edge || "top");
  if (e === "left" || e === "all") {
    return {
      fromMm: Math.max(0, lo),
      toMm: Math.min(pageWidthMm, hi),
    };
  }
  if (e === "right") {
    return {
      fromMm: Math.max(0, pageWidthMm - hi),
      toMm: Math.min(pageWidthMm, pageWidthMm - lo),
    };
  }
  if (e === "top") {
    return {
      fromMm: Math.max(0, lo),
      toMm: Math.min(pageHeightMm, hi),
    };
  }
  if (e === "bottom") {
    return {
      fromMm: Math.max(0, pageHeightMm - hi),
      toMm: Math.min(pageHeightMm, pageHeightMm - lo),
    };
  }
  return null;
}

/**
 * Sangria fora do papel: profundidade P → from=-P, to=0.
 * aMm/bMm = trecho no eixo paralelo à borda (Y para left/right, X para top/bottom).
 */
export function sangriaFromDrag(
  edge: EdgeKey,
  depthMm: number,
  aMm: number,
  bMm: number,
  pageWidthMm: number,
  pageHeightMm: number,
): {
  fromMm: number;
  toMm: number;
  alongFromMm: number;
  alongToMm: number;
} | null {
  const depth = Math.abs(Number(depthMm) || 0);
  if (depth < 0.5 || depth > 50) return null;
  const lo = Math.min(aMm, bMm);
  const hi = Math.max(aMm, bMm);
  if (hi - lo < 0.5) return null;
  const e = String(edge || "left");
  const vertical = e === "left" || e === "right";
  const maxAlong = vertical ? pageHeightMm : pageWidthMm;
  const alongFromMm = clamp(lo, -50, maxAlong + 50);
  const alongToMm = clamp(hi, -50, maxAlong + 50);
  if (alongToMm - alongFromMm < 0.5) return null;
  return {
    fromMm: -round3(depth),
    toMm: 0,
    alongFromMm: round3(alongFromMm),
    alongToMm: round3(alongToMm),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Retângulo SVG (px) da sangria a partir da geometria mm. */
export function sangriaSvgRect(
  edge: string,
  fromMm: number,
  toMm: number,
  alongFromMm: number,
  alongToMm: number,
  displayWidth: number,
  displayHeight: number,
  sx: number,
  sy: number,
): { x: number; y: number; width: number; height: number } {
  const from = Number(fromMm) || 0;
  const to = Number(toMm) || 0;
  const a0 = Math.min(Number(alongFromMm) || 0, Number(alongToMm) || 0);
  const a1 = Math.max(Number(alongFromMm) || 0, Number(alongToMm) || 0);
  const e = String(edge || "left");
  if (e === "top") {
    return {
      x: a0 * sx,
      y: from * sy,
      width: Math.max(1, (a1 - a0) * sx),
      height: Math.max(1, (to - from) * sy),
    };
  }
  if (e === "bottom") {
    return {
      x: a0 * sx,
      y: displayHeight - to * sy,
      width: Math.max(1, (a1 - a0) * sx),
      height: Math.max(1, (to - from) * sy),
    };
  }
  if (e === "left") {
    return {
      x: from * sx,
      y: a0 * sy,
      width: Math.max(1, (to - from) * sx),
      height: Math.max(1, (a1 - a0) * sy),
    };
  }
  // right
  return {
    x: displayWidth - to * sx,
    y: a0 * sy,
    width: Math.max(1, (to - from) * sx),
    height: Math.max(1, (a1 - a0) * sy),
  };
}

/**
 * Sangria em todas as bordas: 4 faixas com o trecho estendido para além dos
 * cantos, formando uma moldura fechada em volta do papel.
 */
export function sangriaAllRects(
  depthMm: number,
  pageWidthMm: number,
  pageHeightMm: number,
  displayWidth: number,
  displayHeight: number,
  sx: number,
  sy: number,
): Array<{
  edge: EdgeKey;
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const depth = Math.abs(Number(depthMm) || 0);
  if (depth <= 0) return [];
  const edges: EdgeKey[] = ["top", "right", "bottom", "left"];
  return edges.map((edge) => {
    const vertical = edge === "left" || edge === "right";
    const along = vertical ? pageHeightMm : pageWidthMm;
    return {
      edge,
      ...sangriaSvgRect(
        edge,
        -depth,
        0,
        -depth,
        along + depth,
        displayWidth,
        displayHeight,
        sx,
        sy,
      ),
    };
  });
}

export interface MarkGeometryLike {
  edge?: string;
  offsetMm?: number;
  fromMm?: number;
  toMm?: number;
  alongFromMm?: number;
  alongToMm?: number;
  xMm?: number;
  yMm?: number;
  wMm?: number;
  hMm?: number;
  x1Mm?: number;
  y1Mm?: number;
  x2Mm?: number;
  y2Mm?: number;
  stepMm?: number;
  texto?: string;
  tamanhoPt?: number;
  espessura?: number;
  points?: number[][];
  [key: string]: number | string | number[][] | undefined;
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
  if (!mark.espelhar) return false;
  const origem = Number(mark.paginaOrigem);
  // Sem página de referência (legado / origem 0), não espelha — a geometria gravada é a do técnico.
  if (!Number.isFinite(origem) || origem < 1) return false;
  return pageNumber % 2 !== origem % 2;
}

export function resolveMarkGeometry(
  mark: MarkMirrorInput,
  pageNumber: number,
  pageWidthMm: number,
): MarkGeometryLike {
  const g = { ...mark.geometria };
  if (!shouldMirrorMark(mark, pageNumber)) return g;

  if (mark.tipo === "offset_corte" || mark.tipo === "faixa" || mark.tipo === "sangria") {
    return { ...g, edge: mirrorEdge(String(g.edge || "top")) };
  }
  if (mark.tipo === "retangulo" || mark.tipo === "circulo") {
    const x = Number(g.xMm) || 0;
    const w = Number(g.wMm) || 0;
    return {
      ...g,
      xMm: Math.max(0, pageWidthMm - x - w),
    };
  }
  if (mark.tipo === "ponto" || mark.tipo === "texto") {
    const x = Number(g.xMm) || 0;
    return { ...g, xMm: Math.max(0, pageWidthMm - x) };
  }
  if (mark.tipo === "medida" || mark.tipo === "seta") {
    const x1 = Number(g.x1Mm) || 0;
    const x2 = Number(g.x2Mm) || 0;
    return {
      ...g,
      x1Mm: Math.max(0, pageWidthMm - x1),
      x2Mm: Math.max(0, pageWidthMm - x2),
    };
  }
  if (mark.tipo === "livre") {
    const pts = Array.isArray(g.points) ? g.points : [];
    return {
      ...g,
      points: pts.map((pt) => {
        const x = Number(pt?.[0]) || 0;
        const y = Number(pt?.[1]) || 0;
        return [Math.max(0, pageWidthMm - x), y];
      }),
    };
  }
  return g;
}
