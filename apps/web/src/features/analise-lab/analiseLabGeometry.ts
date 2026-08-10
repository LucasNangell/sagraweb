/** Conversões e utilidades geométricas do Análise Lab (mm ↔ px). */

export const PT_TO_MM = 25.4 / 72;

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
