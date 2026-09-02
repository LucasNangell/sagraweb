import { describe, expect, it } from "vitest";

import {
  blockThicknessFromPageCount,
  clampHoleCount,
  clampHoleDiameterMm,
  clampMarginFromEdgeMm,
  clampSpiralParams,
  maxMarginForFormat,
  suggestHoleCount,
} from "./spiralBinding";

describe("spiralBinding clamps", () => {
  it("clampa holeCount / diameter / margin", () => {
    expect(clampHoleCount(1)).toBe(4);
    expect(clampHoleCount(99)).toBe(80);
    expect(clampHoleCount(50)).toBe(50);
    expect(clampHoleCount(Number.NaN)).toBe(40);
    expect(clampHoleDiameterMm(0)).toBe(2);
    expect(clampHoleDiameterMm(20)).toBe(12);
    expect(clampHoleDiameterMm(Number.NaN)).toBe(3);
    expect(clampMarginFromEdgeMm(1)).toBe(3);
    expect(clampMarginFromEdgeMm(50)).toBe(30);
  });

  it("sugere furos pelo span útil", () => {
    expect(suggestHoleCount(210)).toBeGreaterThanOrEqual(4);
    expect(suggestHoleCount(210)).toBeLessThanOrEqual(80);
    expect(suggestHoleCount(100)).toBeLessThan(suggestHoleCount(297));
  });

  it("limita margem ao formato", () => {
    expect(maxMarginForFormat(100, 200, "left")).toBeLessThanOrEqual(45);
    const p = clampSpiralParams(
      { edge: "left", marginFromEdgeMm: 40, holeCount: 14, holeDiameterMm: 5 },
      { w: 80, h: 200 },
    );
    expect(p.marginFromEdgeMm).toBeLessThanOrEqual(maxMarginForFormat(80, 200, "left"));
  });

  it("espessura do bloco cresce com páginas e fica no clamp", () => {
    expect(blockThicknessFromPageCount(1)).toBeGreaterThanOrEqual(4);
    expect(blockThicknessFromPageCount(200)).toBeLessThanOrEqual(32);
    expect(blockThicknessFromPageCount(50)).toBeGreaterThan(
      blockThicknessFromPageCount(10),
    );
  });
});
