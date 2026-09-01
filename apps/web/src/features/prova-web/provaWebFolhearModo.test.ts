import { describe, expect, it } from "vitest";

import { buildSpreadRows } from "@/features/analise-lab/analiseLabFit";

import {
  normalizeProvaWebFolhearModo,
  shouldUseSheetsViewer,
} from "./provaWebFolhearModo";

describe("provaWebFolhearModo", () => {
  it("default da Prova WEB é flipbook (legado)", () => {
    expect(normalizeProvaWebFolhearModo(undefined)).toBe("flipbook");
    expect(normalizeProvaWebFolhearModo(null)).toBe("flipbook");
    expect(normalizeProvaWebFolhearModo("")).toBe("flipbook");
    expect(normalizeProvaWebFolhearModo("invalid")).toBe("flipbook");
  });

  it("aceita flipbook e folhas", () => {
    expect(normalizeProvaWebFolhearModo("flipbook")).toBe("flipbook");
    expect(normalizeProvaWebFolhearModo("FOLHAS")).toBe("folhas");
  });

  it("sheets viewer só com folhas", () => {
    expect(shouldUseSheetsViewer("folhas")).toBe(true);
    expect(shouldUseSheetsViewer("flipbook")).toBe(false);
    expect(shouldUseSheetsViewer(undefined)).toBe(false);
  });
});

describe("folhas agrupamento (simples vs dupla)", () => {
  const pages = [1, 2, 3, 4, 5];

  it("simples: uma página por linha", () => {
    expect(buildSpreadRows(pages, "simples")).toEqual([
      [1],
      [2],
      [3],
      [4],
      [5],
    ]);
  });

  it("dupla: capa isolada e depois pares", () => {
    expect(buildSpreadRows(pages, "dupla")).toEqual([[1], [2, 3], [4, 5]]);
  });
});
