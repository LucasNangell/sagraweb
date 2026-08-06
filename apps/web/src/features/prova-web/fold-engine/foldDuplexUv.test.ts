import { describe, expect, it } from "vitest";

import {
  duplexBackBandMm,
  duplexMirrorPositionMm,
} from "./foldDuplex";
import { DEFAULT_ARTWORK_BACK } from "./foldTypes";

describe("duplex turn back mapping", () => {
  it("DEFAULT_ARTWORK_BACK liga o duplex", () => {
    expect(DEFAULT_ARTWORK_BACK.mirrorX).toBe(true);
  });

  it("vinco da frente em 97mm vira última marca a 97mm da outra borda", () => {
    expect(duplexMirrorPositionMm(97, 297)).toBeCloseTo(200, 5);
    expect(297 - duplexMirrorPositionMm(97, 297)).toBeCloseTo(97, 5);
  });

  it("abas desiguais: faixa do verso mantém a largura do painel da frente", () => {
    const pageW = 297;
    const left = duplexBackBandMm(0, 97, pageW, true);
    const center = duplexBackBandMm(97, 120, pageW, true);
    const right = duplexBackBandMm(217, 80, pageW, true);

    expect(left.bandWidthMm).toBeCloseTo(97, 5);
    expect(center.bandWidthMm).toBeCloseTo(120, 5);
    expect(right.bandWidthMm).toBeCloseTo(80, 5);

    // Esquerda da frente ← direita do PDF; direita da frente ← esquerda do PDF
    expect(left.u0).toBeCloseTo(200 / pageW, 5);
    expect(left.u1).toBeCloseTo(1, 5);
    expect(right.u0).toBeCloseTo(0, 5);
    expect(right.u1).toBeCloseTo(80 / pageW, 5);
  });

  it("sem duplex mantém o mapeamento flat do PDF", () => {
    const band = duplexBackBandMm(0, 97, 297, false);
    expect(band.u0).toBe(0);
    expect(band.u1).toBeCloseTo(97 / 297, 5);
  });
});
