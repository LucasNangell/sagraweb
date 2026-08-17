import { describe, expect, it } from "vitest";

import {
  assignFonte,
  canGenerateLabFontes,
  deriveLegacyPaths,
  moveFonte,
  resolveLabPageCrop,
  seedLabFontes,
} from "./analiseLabFontes";

describe("analiseLabFontes", () => {
  it("seeds named capa/miolo and leaves extras unassigned", () => {
    const seeded = seedLabFontes(
      [
        { path: "v/capa.pdf", name: "capa.pdf" },
        { path: "v/miolo.pdf", name: "miolo.pdf" },
        { path: "v/encarte.pdf", name: "encarte.pdf" },
      ],
      "capa_miolo",
    );
    expect(seeded.map((f) => f.componente)).toEqual(["Capa", "Miolo"]);
    expect(seeded.map((f) => f.path)).toEqual(["v/capa.pdf", "v/miolo.pdf"]);
  });

  it("seeds unnamed extras into miolo after first capa", () => {
    const seeded = seedLabFontes(
      [
        { path: "v/a.pdf", name: "a.pdf" },
        { path: "v/b.pdf", name: "b.pdf" },
        { path: "v/c.pdf", name: "c.pdf" },
      ],
      "capa_miolo",
    );
    expect(seeded.filter((f) => f.componente === "Capa")).toHaveLength(1);
    expect(seeded.filter((f) => f.componente === "Miolo")).toHaveLength(2);
  });

  it("requires capa and miolo to generate", () => {
    expect(
      canGenerateLabFontes(
        [{ path: "c.pdf", componente: "Capa", ordem: 0 }],
        "capa_miolo",
      ),
    ).toBe(false);
    expect(
      canGenerateLabFontes(
        [
          { path: "c.pdf", componente: "Capa", ordem: 0 },
          { path: "m.pdf", componente: "Miolo", ordem: 0 },
        ],
        "capa_miolo",
      ),
    ).toBe(true);
  });

  it("reorders files inside a component", () => {
    const fontes = [
      { path: "a.pdf", componente: "Miolo" as const, ordem: 0 },
      { path: "b.pdf", componente: "Miolo" as const, ordem: 1 },
      { path: "c.pdf", componente: "Capa" as const, ordem: 0 },
    ];
    const next = moveFonte(fontes, "a.pdf", 1);
    expect(
      next
        .filter((f) => f.componente === "Miolo")
        .map((f) => f.path),
    ).toEqual(["b.pdf", "a.pdf"]);
  });

  it("assigns and unassigns files", () => {
    const next = assignFonte(
      [{ path: "a.pdf", componente: "Capa", ordem: 0 }],
      "b.pdf",
      "Miolo",
    );
    expect(next).toHaveLength(2);
    const cleared = assignFonte(next, "a.pdf", null);
    expect(cleared.map((f) => f.path)).toEqual(["b.pdf"]);
  });

  it("derives legacy first-file columns", () => {
    const paths = deriveLegacyPaths(
      [
        { path: "c1.pdf", componente: "Capa", ordem: 0 },
        { path: "c2.pdf", componente: "Capa", ordem: 1 },
        { path: "m.pdf", componente: "Miolo", ordem: 0 },
      ],
      "capa_miolo",
    );
    expect(paths.arquivo_capa).toBe("c1.pdf");
    expect(paths.arquivo_miolo).toBe("m.pdf");
  });

  it("resolves crop page > file > component > all", () => {
    const crop = resolveLabPageCrop(
      {
        miolo: { top: 1, right: 1, bottom: 1, left: 1 },
        lab: {
          files: { "m.pdf": { top: 3, right: 3, bottom: 3, left: 3 } },
          pages: { "m.pdf#2": { top: 4, right: 4, bottom: 4, left: 4 } },
        },
      },
      { path: "m.pdf", sourcePage: 2, componente: "Miolo" },
    );
    expect(crop.top).toBe(4);
  });

  it("mirrors miolo central crop on even sequence pages", () => {
    const odd = resolveLabPageCrop(
      {
        miolo: { top: 1, right: 2, bottom: 3, left: 8 },
        lab: { mioloCentral: true },
      },
      { path: "m.pdf", sourcePage: 1, componente: "Miolo", sequencePage: 1 },
    );
    expect(odd.left).toBe(8);
    expect(odd.right).toBe(2);
    const even = resolveLabPageCrop(
      {
        miolo: { top: 1, right: 2, bottom: 3, left: 8 },
        lab: { mioloCentral: true },
      },
      { path: "m.pdf", sourcePage: 2, componente: "Miolo", sequencePage: 2 },
    );
    expect(even.left).toBe(2);
    expect(even.right).toBe(8);
    expect(even.top).toBe(1);
    const pageOverride = resolveLabPageCrop(
      {
        miolo: { top: 1, right: 2, bottom: 3, left: 8 },
        lab: {
          mioloCentral: true,
          pages: { "m.pdf#2": { top: 0, right: 9, bottom: 0, left: 1 } },
        },
      },
      { path: "m.pdf", sourcePage: 2, componente: "Miolo", sequencePage: 2 },
    );
    expect(pageOverride.left).toBe(1);
    expect(pageOverride.right).toBe(9);
  });
});
