import type { ProvaWebEspiralCrop } from "@/api/provaWeb";

export type SpiralEdge = "left" | "top";

export const SPIRAL_HOLE_COUNT_MIN = 4;
export const SPIRAL_HOLE_COUNT_MAX = 80;
export const SPIRAL_HOLE_COUNT_DEFAULT = 40;
export const SPIRAL_HOLE_DIA_MIN = 2;
export const SPIRAL_HOLE_DIA_MAX = 12;
export const SPIRAL_HOLE_DIA_DEFAULT = 3;
export const SPIRAL_MARGIN_MIN = 3;
export const SPIRAL_MARGIN_MAX = 30;

/** Pitch tipográfico ~12–14 mm entre centros. */
const HOLE_PITCH_MM = 13;

export function clampHoleCount(n: number): number {
  if (!Number.isFinite(n)) return SPIRAL_HOLE_COUNT_DEFAULT;
  return Math.max(SPIRAL_HOLE_COUNT_MIN, Math.min(SPIRAL_HOLE_COUNT_MAX, Math.round(n)));
}

export function clampHoleDiameterMm(mm: number): number {
  if (!Number.isFinite(mm)) return SPIRAL_HOLE_DIA_DEFAULT;
  return Math.max(SPIRAL_HOLE_DIA_MIN, Math.min(SPIRAL_HOLE_DIA_MAX, mm));
}

export function clampMarginFromEdgeMm(mm: number): number {
  if (!Number.isFinite(mm)) return 8;
  return Math.max(SPIRAL_MARGIN_MIN, Math.min(SPIRAL_MARGIN_MAX, mm));
}

/**
 * Sugere nº de furos pelo lado útil da borda de binding
 * (altura se left, largura se top).
 */
export function suggestHoleCount(
  usableSpanMm: number,
  holeDiameterMm = SPIRAL_HOLE_DIA_DEFAULT,
): number {
  const span = Math.max(20, usableSpanMm);
  const pitch = Math.max(holeDiameterMm * 1.8, HOLE_PITCH_MM);
  return clampHoleCount(Math.floor((span - holeDiameterMm) / pitch));
}

/**
 * Espessura visual do bloco (mm) a partir do nº de páginas renderizadas.
 * ~0,1 mm/folha + capas; clamp para o mockup CSS.
 */
export function blockThicknessFromPageCount(pageCount: number): number {
  const n = Math.max(1, Math.floor(pageCount));
  return Math.round(Math.max(4, Math.min(32, n * 0.1 + 2)) * 10) / 10;
}

/** Margem máxima útil: não passar da metade do menor lado. */
export function maxMarginForFormat(
  usableW: number,
  usableH: number,
  edge: SpiralEdge,
): number {
  const span = edge === "left" ? usableW : usableH;
  return Math.max(
    SPIRAL_MARGIN_MIN,
    Math.min(SPIRAL_MARGIN_MAX, span * 0.45),
  );
}

export function clampSpiralParams(
  partial: Partial<
    Pick<
      ProvaWebEspiralCrop,
      "edge" | "holeCount" | "holeDiameterMm" | "marginFromEdgeMm"
    >
  >,
  usable?: { w: number; h: number },
): Pick<
  ProvaWebEspiralCrop,
  "edge" | "holeCount" | "holeDiameterMm" | "marginFromEdgeMm"
> {
  const edge: SpiralEdge = partial.edge === "top" ? "top" : "left";
  const holeDiameterMm = clampHoleDiameterMm(
    partial.holeDiameterMm ?? SPIRAL_HOLE_DIA_DEFAULT,
  );
  let marginFromEdgeMm = clampMarginFromEdgeMm(partial.marginFromEdgeMm ?? 8);
  if (usable) {
    const maxM = maxMarginForFormat(usable.w, usable.h, edge);
    marginFromEdgeMm = Math.min(marginFromEdgeMm, maxM);
    marginFromEdgeMm = clampMarginFromEdgeMm(marginFromEdgeMm);
  }
  return {
    edge,
    holeCount: clampHoleCount(partial.holeCount ?? SPIRAL_HOLE_COUNT_DEFAULT),
    holeDiameterMm,
    marginFromEdgeMm,
  };
}

export type SpiralHoleGuide = {
  edge: SpiralEdge;
  holeCount: number;
  holeDiameterMm: number;
  marginFromEdgeMm: number;
};
