import { DEFAULT_PHYSICAL, type FoldPhysicalProperties } from "./foldTypes";

export function resolvePhysical(
  partial?: Partial<FoldPhysicalProperties> | null,
): FoldPhysicalProperties {
  return {
    paperThicknessMm:
      partial?.paperThicknessMm ?? DEFAULT_PHYSICAL.paperThicknessMm,
    renderGapMm: partial?.renderGapMm ?? DEFAULT_PHYSICAL.renderGapMm,
    creaseRadiusMm: partial?.creaseRadiusMm ?? DEFAULT_PHYSICAL.creaseRadiusMm,
  };
}

/** Espessura efetiva de render (papel + gap visual). */
export function renderThicknessMm(p: FoldPhysicalProperties): number {
  return Math.max(0.05, p.paperThicknessMm + p.renderGapMm);
}
