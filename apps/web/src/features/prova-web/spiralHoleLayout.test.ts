import { describe, expect, it } from "vitest";

import type { ProvaWebSpiralMockupMeta } from "@/api/provaWeb";

import {
  SPIRAL_HOLE_COUNT_DEFAULT,
  SPIRAL_HOLE_COUNT_MAX,
  clampHoleCount,
} from "./spiralBinding";

/** Cópia leve da lógica de furos (sem Three) para teste. */
function holePositionsMm(meta: ProvaWebSpiralMockupMeta) {
  const w = Math.max(40, meta.pageWidthMm);
  const h = Math.max(40, meta.pageHeightMm);
  const n = clampHoleCount(meta.holeCount ?? SPIRAL_HOLE_COUNT_DEFAULT);
  const margin = Math.max(3, meta.marginFromEdgeMm || 8);
  const edge = meta.edge === "top" ? "top" : "left";
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    if (edge === "left") {
      out.push({ x: -w / 2 + margin, y: -h / 2 + t * h });
    } else {
      out.push({ x: -w / 2 + t * w, y: h / 2 - margin });
    }
  }
  return out;
}

describe("spiral hole layout", () => {
  const base: ProvaWebSpiralMockupMeta = {
    edge: "left",
    holeCount: 10,
    holeDiameterMm: 5,
    marginFromEdgeMm: 8,
    pageWidthMm: 210,
    pageHeightMm: 297,
    blockThicknessMm: 8,
  };

  it("left: furos na margem esquerda, espalhados na altura", () => {
    const holes = holePositionsMm(base);
    expect(holes).toHaveLength(10);
    expect(holes[0]!.x).toBeCloseTo(-210 / 2 + 8, 5);
    expect(holes[0]!.y).toBeLessThan(holes[9]!.y);
  });

  it("top: furos na borda superior", () => {
    const holes = holePositionsMm({ ...base, edge: "top" });
    expect(holes[0]!.y).toBeCloseTo(297 / 2 - 8, 5);
    expect(holes[0]!.x).toBeLessThan(holes[9]!.x);
  });

  it("aceita mais de 40 furos até o teto", () => {
    expect(holePositionsMm({ ...base, holeCount: 50 })).toHaveLength(50);
    expect(holePositionsMm({ ...base, holeCount: 99 })).toHaveLength(
      SPIRAL_HOLE_COUNT_MAX,
    );
  });
});
