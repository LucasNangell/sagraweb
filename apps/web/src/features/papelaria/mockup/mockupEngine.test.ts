import { describe, expect, it } from "vitest";

import { resolveSceneBasePx, sceneDimensionsPx } from "./mockupEngine";
import type { PapelariaMockupConfig } from "./types";

const SQUARE_CONFIG: PapelariaMockupConfig = {
  id: "test_square",
  nome: "Test square",
  modo: "folha_simples",
  larguraAbertaMm: 100,
  alturaAbertaMm: 100,
  larguraFechadaMm: 100,
  alturaFechadaMm: 100,
  orientacao: "retrato",
  faces: [],
  cena: { escalaBase: 1 },
};

describe("resolveSceneBasePx", () => {
  it("escolhe a base que cabe na área disponível (safety incluso)", () => {
    // safety 1 → maxBase = min(400, 400) = 400
    expect(resolveSceneBasePx(SQUARE_CONFIG, 0, 400, 400, 1)).toBe(400);
    // safety 0.82 → 328
    expect(resolveSceneBasePx(SQUARE_CONFIG, 0, 400, 400, 0.82)).toBe(328);
  });

  it("respeita piso 160 e teto 960", () => {
    expect(resolveSceneBasePx(SQUARE_CONFIG, 0, 50, 50, 1)).toBe(160);
    expect(resolveSceneBasePx(SQUARE_CONFIG, 0, 2000, 2000, 1)).toBe(960);
  });

  it("o card resultante permanece dentro da área com safety 0.82", () => {
    const availW = 800;
    const availH = 600;
    const safety = 0.82;
    const base = resolveSceneBasePx(SQUARE_CONFIG, 0, availW, availH, safety);
    const dims = sceneDimensionsPx(SQUARE_CONFIG, 0, base);
    expect(dims.width).toBeLessThanOrEqual(availW * safety + 1);
    expect(dims.height).toBeLessThanOrEqual(availH * safety + 1);
  });
});
