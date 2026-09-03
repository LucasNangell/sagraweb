import { describe, expect, it, vi } from "vitest";

import { softenFlipbookPages } from "./softenFlipbookPages";

function mockFlip(count: number) {
  const pages = Array.from({ length: count }, () => ({
    setDensity: vi.fn(),
    setDrawingDensity: vi.fn(),
  }));
  return {
    pages,
    flip: {
      getPageCount: () => pages.length,
      getPage: (index: number) => pages[index],
    },
  };
}

describe("softenFlipbookPages", () => {
  it("marca todas as páginas como soft (capa e contracapa inclusive)", () => {
    const { pages, flip } = mockFlip(4);
    pages.forEach((p) => {
      p.setDensity("hard");
      p.setDrawingDensity("hard");
    });

    softenFlipbookPages(flip);

    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(page.setDensity).toHaveBeenLastCalledWith("soft");
      expect(page.setDrawingDensity).toHaveBeenLastCalledWith("soft");
    }
  });

  it("não quebra com flip vazio ou sem API", () => {
    expect(() => softenFlipbookPages({})).not.toThrow();
    expect(() => softenFlipbookPages(null)).not.toThrow();
    expect(() =>
      softenFlipbookPages({
        getPageCount: () => 2,
        getPage: () => ({}),
      }),
    ).not.toThrow();
  });
});
