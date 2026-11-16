import { describe, expect, it } from "vitest";

import {
  formatDimensionMm,
  resolveProductDimensionsMm,
} from "./resolveProductDimensionsMm";

describe("resolveProductDimensionsMm", () => {
  it("usa dimensões fechadas quando existem", () => {
    expect(
      resolveProductDimensionsMm({
        larguraAbertaMm: 210,
        alturaAbertaMm: 296,
        larguraFechadaMm: 105,
        alturaFechadaMm: 148,
      }),
    ).toEqual({ widthMm: 105, heightMm: 148 });
  });

  it("cai para dimensões abertas quando fechadas não existem", () => {
    expect(
      resolveProductDimensionsMm({
        larguraAbertaMm: 90,
        alturaAbertaMm: 50,
      }),
    ).toEqual({ widthMm: 90, heightMm: 50 });
  });
});

describe("formatDimensionMm", () => {
  it("formata inteiros e decimais", () => {
    expect(formatDimensionMm(90)).toBe("90");
    expect(formatDimensionMm(90.5)).toBe("90.5");
    expect(formatDimensionMm(0)).toBe("—");
  });
});
