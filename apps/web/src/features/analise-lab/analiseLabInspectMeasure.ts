/** Helpers de medidas efêmeras da Inspeção (área / régua) em mm. */

export type InspectMeasureMode = "off" | "area" | "ruler";

export interface MmPoint {
  xMm: number;
  yMm: number;
}

export interface AreaMeasure {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface RulerMeasure {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export function rectFromPoints(a: MmPoint, b: MmPoint): AreaMeasure {
  const xMm = Math.min(a.xMm, b.xMm);
  const yMm = Math.min(a.yMm, b.yMm);
  const wMm = Math.abs(b.xMm - a.xMm);
  const hMm = Math.abs(b.yMm - a.yMm);
  return {
    xMm: Math.round(xMm * 100) / 100,
    yMm: Math.round(yMm * 100) / 100,
    wMm: Math.round(wMm * 100) / 100,
    hMm: Math.round(hMm * 100) / 100,
  };
}

export function distanceMm(a: MmPoint, b: MmPoint): number {
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  return Math.round(Math.hypot(dx, dy) * 100) / 100;
}

export function deltaMm(a: MmPoint, b: MmPoint): { dxMm: number; dyMm: number } {
  return {
    dxMm: Math.round((b.xMm - a.xMm) * 100) / 100,
    dyMm: Math.round((b.yMm - a.yMm) * 100) / 100,
  };
}

export function rulerFromPoints(a: MmPoint, b: MmPoint): RulerMeasure {
  return {
    x1Mm: Math.round(a.xMm * 100) / 100,
    y1Mm: Math.round(a.yMm * 100) / 100,
    x2Mm: Math.round(b.xMm * 100) / 100,
    y2Mm: Math.round(b.yMm * 100) / 100,
  };
}
