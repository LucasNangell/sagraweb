import { POSITION_EPSILON_MM } from "./foldTypes";

export function quantizeMm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return (
    Math.round(value / POSITION_EPSILON_MM) * POSITION_EPSILON_MM
  );
}

export function nearlyEqualMm(a: number, b: number, eps = POSITION_EPSILON_MM): boolean {
  return Math.abs(a - b) <= eps;
}

/** Ordena e deduplica quebras 1D com quantização. */
export function uniqueSortedBreaks(spanMm: number, cuts: number[]): number[] {
  const pts = [0, ...cuts.map(quantizeMm), quantizeMm(spanMm)];
  const sorted = [...new Set(pts.map(quantizeMm))].sort((a, b) => a - b);
  const out: number[] = [sorted[0] ?? 0];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!;
    if (!nearlyEqualMm(v, out[out.length - 1]!)) out.push(v);
  }
  const end = quantizeMm(spanMm);
  if (!nearlyEqualMm(out[out.length - 1]!, end)) out.push(end);
  return out;
}

export function panelId(row: number, column: number, multiRow: boolean): string {
  return multiRow ? `p${row}_${column}` : `p${column}`;
}
