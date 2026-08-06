import { describe, expect, it } from "vitest";

import type { ProvaWebPageMeta } from "@/api/provaWeb";

import {
  computeFlipbookPageSize,
  mergeLoadedWindow,
  seedLoadedWindow,
} from "./flipbookFit";

const pages: ProvaWebPageMeta[] = [
  { page: 1, role: "cover-front", width: 400, height: 600 },
  { page: 2, role: "page", width: 400, height: 600 },
  { page: 3, role: "page", width: 400, height: 600 },
  { page: 4, role: "cover-back", width: 400, height: 600 },
];

describe("flipbookFit", () => {
  it("seedLoadedWindow inclui capa e janela da página 0", () => {
    const url = (p: ProvaWebPageMeta) => `u/${p.page}`;
    const seeded = seedLoadedWindow(pages, 0, url);
    expect(seeded[1]).toBe("u/1");
    expect(seeded[2]).toBe("u/2");
    expect(seeded[3]).toBe("u/3");
    expect(seeded[4]).toBe("u/4"); // capa / contracapa
  });

  it("mergeLoadedWindow é sticky e não apaga entradas", () => {
    const url = (p: ProvaWebPageMeta) => `u/${p.page}`;
    const prev = { 1: "u/1", 99: "keep" };
    const next = mergeLoadedWindow(prev, pages, 2, url);
    expect(next[99]).toBe("keep");
    expect(next[1]).toBe("u/1");
    expect(next[2]).toBe("u/2");
    expect(next[3]).toBe("u/3");
    expect(next[4]).toBe("u/4");
  });

  it("computeFlipbookPageSize: capa (1p) cabem em avail sem estourar", () => {
    const size = computeFlipbookPageSize({
      pageW: 420,
      pageH: 595, // A5-ish
      availW: 800,
      availH: 500,
      spread: false,
    });
    expect(size.height).toBeLessThanOrEqual(500);
    expect(size.width).toBeLessThanOrEqual(800);
    expect(size.width / size.height).toBeCloseTo(420 / 595, 2);
  });

  it("computeFlipbookPageSize: spread (2p) cabem na largura e altura", () => {
    const size = computeFlipbookPageSize({
      pageW: 420,
      pageH: 595,
      availW: 900,
      availH: 500,
      spread: true,
    });
    expect(size.width * 2).toBeLessThanOrEqual(900);
    expect(size.height).toBeLessThanOrEqual(500);
  });

  it("spread=true deixa capa e miolo com a mesma page size (slot estável)", () => {
    const avail = { pageW: 420, pageH: 595, availW: 1000, availH: 700 };
    const forSpread = computeFlipbookPageSize({ ...avail, spread: true });
    // Folhear usa sempre spread:true — capa não muda de escala ao abrir.
    expect(forSpread.width * 2).toBeLessThanOrEqual(1000);
    expect(forSpread.height).toBeLessThanOrEqual(700);
    const alone = computeFlipbookPageSize({ ...avail, spread: false });
    // Contenção do miolo é mais restritiva (ou igual) que 1 página.
    expect(forSpread.width).toBeLessThanOrEqual(alone.width);
    expect(forSpread.height).toBeLessThanOrEqual(alone.height);
  });
});
