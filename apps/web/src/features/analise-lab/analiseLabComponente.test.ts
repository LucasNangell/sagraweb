import { describe, expect, it } from "vitest";

import {
  componenteForPages,
  itemHomesForComponents,
  itemOccurrences,
  roleToComponente,
  splitScopeByComponente,
} from "./analiseLabComponente";
import type { ProvaWebPageMeta } from "@/api/provaWeb";
import { parsePageSpec } from "./analiseLabPageSpec";
import {
  clampPanelPosition,
  pageNumberToIndex,
  spreadLeftPage,
} from "./analiseLabPageSync";

const pages = [
  { page: 1, role: "cover-front" },
  { page: 2, role: "cover-front-inside" },
  { page: 3, role: "page" },
  { page: 4, role: "page" },
  { page: 5, role: "cover-back" },
] as ProvaWebPageMeta[];

describe("analiseLabComponente", () => {
  it("maps roles", () => {
    expect(roleToComponente("cover-front", "capa_miolo")).toBe("Capa");
    expect(roleToComponente("page", "capa_miolo")).toBe("Miolo");
    expect(roleToComponente("page", "unico")).toBe("Arq. Único");
  });

  it("splits scope across capas and miolo", () => {
    const split = splitScopeByComponente("capa_miolo", pages, [1, 2, 3, 4]);
    expect(split).toEqual([
      { componente: "Capa", pages: [1, 2] },
      { componente: "Miolo", pages: [3, 4] },
    ]);
    expect(componenteForPages("unico", pages, [1, 3])["Arq. Único"]).toEqual([
      1, 3,
    ]);
  });

  it("computes occurrences", () => {
    expect(
      itemOccurrences(
        { escopo: "pagina", pagina: 3 },
        pages,
        parsePageSpec,
      ),
    ).toEqual([3]);
    expect(
      itemOccurrences(
        { escopo: "paginas", pagina: 1, paginas: "3-4" },
        pages,
        parsePageSpec,
      ),
    ).toEqual([3, 4]);
    expect(
      itemOccurrences(
        { escopo: "arquivo", pagina: 0, componente: "Capa" },
        pages,
        parsePageSpec,
      ),
    ).toEqual([1, 2, 5]);
  });

  it("lists homes across components for multi-page scope", () => {
    expect(
      itemHomesForComponents(
        { escopo: "paginas", pagina: 1, paginas: "1,3", componente: "Miolo" },
        pages,
        "capa_miolo",
      ).sort(),
    ).toEqual(["Capa", "Miolo"]);
    expect(
      itemHomesForComponents(
        { escopo: "pagina", pagina: 1, componente: "Capa" },
        pages,
        "capa_miolo",
      ),
    ).toEqual(["Capa"]);
  });
});

describe("analiseLabPageSync", () => {
  it("converts page number to index", () => {
    expect(pageNumberToIndex(pages, 4)).toBe(3);
    expect(pageNumberToIndex(pages, 99)).toBe(4);
  });

  it("resolves left page of spread", () => {
    expect(spreadLeftPage(pages, 0)).toBe(1);
    // índice 2 (par) → esquerda do spread = índice 1 → página 2
    expect(spreadLeftPage(pages, 2)).toBe(2);
    // índice 3 (ímpar) → esquerda = índice 3 → página 4
    expect(spreadLeftPage(pages, 3)).toBe(4);
    expect(spreadLeftPage(pages, 4)).toBe(5);
  });

  it("clamps floating panel position", () => {
    expect(clampPanelPosition(-10, -5, 320, 200, 800, 600)).toEqual({
      x: 0,
      y: 0,
    });
    expect(clampPanelPosition(900, 500, 320, 200, 800, 600)).toEqual({
      x: 480,
      y: 400,
    });
  });
});
