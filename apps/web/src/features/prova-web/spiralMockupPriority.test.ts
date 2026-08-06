import { describe, expect, it } from "vitest";

import { defaultEspiralCrop } from "./ProvaWebSpiralWizard";
import { pdfSourcesFromRecord } from "./provaWebPdfSources";

/** Espelha a prioridade do ViewerShell sem montar React. */
function pickMockupKind(meta: {
  foldMockup?: { panels?: unknown[] } | null;
  spiralMockup?: { pageWidthMm?: number } | null;
  bookMockup?: { lombadaMm?: number } | null;
}): "fold" | "spiral" | "book" | "none" {
  const isFold = Boolean(meta.foldMockup?.panels?.length);
  const isSpiral = !isFold && Boolean(meta.spiralMockup?.pageWidthMm);
  const isBook =
    !isFold &&
    !isSpiral &&
    Boolean(meta.bookMockup) &&
    (meta.bookMockup?.lombadaMm ?? 0) > 0;
  if (isFold) return "fold";
  if (isSpiral) return "spiral";
  if (isBook) return "book";
  return "none";
}

describe("viewer mockup priority", () => {
  it("fold vence espiral e livro", () => {
    expect(
      pickMockupKind({
        foldMockup: { panels: [{}] },
        spiralMockup: { pageWidthMm: 210 },
        bookMockup: { lombadaMm: 8 },
      }),
    ).toBe("fold");
  });

  it("espiral vence livro quando não há fold", () => {
    expect(
      pickMockupKind({
        spiralMockup: { pageWidthMm: 210 },
        bookMockup: { lombadaMm: 8 },
      }),
    ).toBe("spiral");
  });

  it("livro só quando não há fold/espiral e lombada > 0", () => {
    expect(pickMockupKind({ bookMockup: { lombadaMm: 8 } })).toBe("book");
    expect(pickMockupKind({ bookMockup: { lombadaMm: 0 } })).toBe("none");
  });
});

describe("defaultEspiralCrop", () => {
  it("defaults tipográficos e sourceKind", () => {
    const u = defaultEspiralCrop("unico");
    expect(u.sourceKind).toBe("unico");
    expect(u.edge).toBe("left");
    expect(u.holeCount).toBe(14);
    expect(u.capa).toBeUndefined();

    const c = defaultEspiralCrop("capa_miolo");
    expect(c.sourceKind).toBe("capa_miolo");
    expect(c.capa?.lombadaMm).toBe(0);
  });
});

describe("pdfSourcesFromRecord espiral", () => {
  it("unico vs capa_miolo", () => {
    expect(
      pdfSourcesFromRecord({
        modo: "espiral",
        arquivoUnico: "a.pdf",
        arquivoCapa: null,
        arquivoMiolo: null,
        pontoRegistro: null,
        dataRegistro: null,
        dataAtualizacao: null,
        cropJson: { espiral: defaultEspiralCrop("unico") },
      }),
    ).toEqual([{ id: "unico", label: "Espiral", path: "a.pdf" }]);

    expect(
      pdfSourcesFromRecord({
        modo: "espiral",
        arquivoUnico: null,
        arquivoCapa: "c.pdf",
        arquivoMiolo: "m.pdf",
        pontoRegistro: null,
        dataRegistro: null,
        dataAtualizacao: null,
        cropJson: { espiral: defaultEspiralCrop("capa_miolo") },
      }),
    ).toEqual([
      { id: "capa", label: "Capa", path: "c.pdf" },
      { id: "miolo", label: "Miolo", path: "m.pdf" },
    ]);
  });
});
