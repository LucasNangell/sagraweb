import { describe, expect, it } from "vitest";

import {
  flipbookPageStackCounts,
  flipbookPageStackWidthPx,
  PAGE_STACK_MAX_PX,
  PAGE_STACK_PX_PER_PAGE,
} from "./flipbookPageStack";

describe("flipbookPageStackCounts", () => {
  it("capa: só pilha à direita", () => {
    expect(flipbookPageStackCounts(120, 0)).toEqual({ left: 0, right: 119 });
  });

  it("miolo: esquerda cresce e direita diminui", () => {
    expect(flipbookPageStackCounts(10, 1)).toEqual({ left: 1, right: 7 });
    expect(flipbookPageStackCounts(10, 2)).toEqual({ left: 1, right: 7 });
    expect(flipbookPageStackCounts(10, 5)).toEqual({ left: 5, right: 3 });
  });

  it("contracapa: só pilha à esquerda", () => {
    expect(flipbookPageStackCounts(10, 9)).toEqual({ left: 9, right: 0 });
    expect(flipbookPageStackCounts(10, 99)).toEqual({ left: 9, right: 0 });
  });

  it("livros curtos e vazios", () => {
    expect(flipbookPageStackCounts(0, 0)).toEqual({ left: 0, right: 0 });
    expect(flipbookPageStackCounts(1, 0)).toEqual({ left: 0, right: 0 });
    expect(flipbookPageStackCounts(2, 0)).toEqual({ left: 0, right: 1 });
    expect(flipbookPageStackCounts(2, 1)).toEqual({ left: 1, right: 0 });
    expect(flipbookPageStackCounts(3, 1)).toEqual({ left: 1, right: 0 });
  });
});

describe("flipbookPageStackWidthPx", () => {
  it("zera com 0 páginas e clampa em livros longos", () => {
    expect(flipbookPageStackWidthPx(0)).toBe(0);
    expect(flipbookPageStackWidthPx(1)).toBe(PAGE_STACK_PX_PER_PAGE);
    expect(flipbookPageStackWidthPx(10_000)).toBe(PAGE_STACK_MAX_PX);
  });
});
