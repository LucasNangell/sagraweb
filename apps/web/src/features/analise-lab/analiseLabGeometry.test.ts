import { describe, expect, it } from "vitest";

import {
  clamp,
  distanceMm,
  faixaFromDrag,
  formatMm,
  mmPerPx,
  mirrorEdge,
  pageSizeMm,
  ptToMm,
  pxPerMm,
  resolveMarkGeometry,
  sangriaAllRects,
  sangriaFromDrag,
  shouldMirrorMark,
} from "./analiseLabGeometry";

describe("analiseLabGeometry", () => {
  it("sangriaAllRects forma moldura fechada nos cantos", () => {
    // 100 × 200 mm renderizados 1 px/mm, sangria de 5 mm.
    const rects = sangriaAllRects(5, 100, 200, 100, 200, 1, 1);
    expect(rects.map((r) => r.edge)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    const [top, right, bottom, left] = rects;
    expect(top).toMatchObject({ x: -5, y: -5, width: 110, height: 5 });
    expect(right).toMatchObject({ x: 100, y: -5, width: 5, height: 210 });
    expect(bottom).toMatchObject({ x: -5, y: 200, width: 110, height: 5 });
    expect(left).toMatchObject({ x: -5, y: -5, width: 5, height: 210 });
    expect(sangriaAllRects(0, 100, 200, 100, 200, 1, 1)).toEqual([]);
  });

  it("converts pt to mm", () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 5);
  });

  it("derives page size in mm", () => {
    const size = pageSizeMm(210 * (72 / 25.4), 297 * (72 / 25.4));
    expect(size.widthMm).toBeCloseTo(210, 1);
    expect(size.heightMm).toBeCloseTo(297, 1);
  });

  it("computes pxPerMm and mmPerPx consistently", () => {
    const ratio = pxPerMm(420, 210);
    expect(ratio).toBeCloseTo(2, 5);
    expect(mmPerPx(420, 210)).toBeCloseTo(0.5, 5);
  });

  it("computes distance and clamps", () => {
    expect(distanceMm(0, 0, 3, 4)).toBeCloseTo(5, 5);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(formatMm(7.25)).toBe("7.3 mm");
  });

  it("mirrors left/right edges and keeps all/top/bottom", () => {
    expect(mirrorEdge("left")).toBe("right");
    expect(mirrorEdge("right")).toBe("left");
    expect(mirrorEdge("top")).toBe("top");
    expect(mirrorEdge("all")).toBe("all");
  });

  it("mirrors faixa and retangulo when parity differs", () => {
    const faixa = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 3,
      tipo: "faixa",
      geometria: { edge: "right", fromMm: 0, toMm: 10 },
    };
    expect(shouldMirrorMark(faixa, 3)).toBe(false);
    expect(shouldMirrorMark(faixa, 4)).toBe(true);
    expect(resolveMarkGeometry(faixa, 4, 210).edge).toBe("left");

    const bySpec = {
      pagina: 1,
      espelhar: true,
      paginaOrigem: 1,
      tipo: "faixa",
      geometria: { edge: "left", fromMm: 0, toMm: 10 },
    };
    expect(shouldMirrorMark(bySpec, 2)).toBe(true);
    expect(resolveMarkGeometry(bySpec, 2, 210).edge).toBe("right");

    const rect = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 1,
      tipo: "retangulo",
      geometria: { xMm: 10, yMm: 5, wMm: 20, hMm: 8 },
    };
    expect(resolveMarkGeometry(rect, 2, 200).xMm).toBe(170);
    expect(resolveMarkGeometry(rect, 1, 200).xMm).toBe(10);

    const seta = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 1,
      tipo: "seta",
      geometria: { x1Mm: 10, y1Mm: 5, x2Mm: 40, y2Mm: 8 },
    };
    expect(resolveMarkGeometry(seta, 2, 200).x1Mm).toBe(190);
    expect(resolveMarkGeometry(seta, 2, 200).x2Mm).toBe(160);

    const livre = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 1,
      tipo: "livre",
      geometria: { points: [[10, 5], [40, 8]] },
    };
    expect(resolveMarkGeometry(livre, 2, 200).points).toEqual([
      [190, 5],
      [160, 8],
    ]);
  });

  it("does not mirror when paginaOrigem is missing or zero", () => {
    const legacy = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 0,
      tipo: "retangulo",
      geometria: { xMm: 10, yMm: 5, wMm: 20, hMm: 8 },
    };
    expect(shouldMirrorMark(legacy, 1)).toBe(false);
    expect(shouldMirrorMark(legacy, 2)).toBe(false);
    expect(resolveMarkGeometry(legacy, 2, 200).xMm).toBe(10);
  });

  it("keeps drawn-page geometry as reference for opposite-parity pages only", () => {
    const rect = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 4,
      tipo: "retangulo",
      geometria: { xMm: 10, yMm: 5, wMm: 20, hMm: 8 },
    };
    expect(shouldMirrorMark(rect, 4)).toBe(false);
    expect(shouldMirrorMark(rect, 3)).toBe(true);
    expect(resolveMarkGeometry(rect, 4, 200).xMm).toBe(10);
    expect(resolveMarkGeometry(rect, 3, 200).xMm).toBe(170);
  });

  it("converts drag interval to faixa De/Até by edge", () => {
    expect(faixaFromDrag("left", 5, 15, 210, 297)).toEqual({
      fromMm: 5,
      toMm: 15,
    });
    expect(faixaFromDrag("right", 200, 210, 210, 297)).toEqual({
      fromMm: 0,
      toMm: 10,
    });
    expect(faixaFromDrag("top", 0, 12, 210, 297)).toEqual({
      fromMm: 0,
      toMm: 12,
    });
    expect(faixaFromDrag("bottom", 287, 297, 210, 297)).toEqual({
      fromMm: 0,
      toMm: 10,
    });
    expect(faixaFromDrag("left", 10, 10.2, 210, 297)).toBeNull();
  });

  it("builds outside-only sangria from along-edge drag", () => {
    expect(sangriaFromDrag("left", 5, 40, 120, 210, 297)).toEqual({
      fromMm: -5,
      toMm: 0,
      alongFromMm: 40,
      alongToMm: 120,
    });
    expect(sangriaFromDrag("top", 3, 10, 80, 210, 297)?.fromMm).toBe(-3);
    expect(sangriaFromDrag("left", 5, 10, 10.2, 210, 297)).toBeNull();
  });

  it("mirrors sangria edge left/right keeping along span", () => {
    const mark = {
      pagina: 0,
      espelhar: true,
      paginaOrigem: 1,
      tipo: "sangria",
      geometria: {
        edge: "left",
        fromMm: -5,
        toMm: 0,
        alongFromMm: 40,
        alongToMm: 120,
      },
    };
    expect(shouldMirrorMark(mark, 1)).toBe(false);
    expect(shouldMirrorMark(mark, 2)).toBe(true);
    expect(resolveMarkGeometry(mark, 2, 210).edge).toBe("right");
    expect(resolveMarkGeometry(mark, 2, 210).alongFromMm).toBe(40);
  });
});
