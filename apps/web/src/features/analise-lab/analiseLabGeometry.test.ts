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
  shouldMirrorMark,
} from "./analiseLabGeometry";

describe("analiseLabGeometry", () => {
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
});
