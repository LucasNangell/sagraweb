import { describe, expect, it } from "vitest";

import { resolveFlapProgress } from "./box-engine/boxTypes";
import { defaultCaixaCrop } from "./ProvaWebBoxWizard";
import { pdfSourcesFromRecord } from "./provaWebPdfSources";

/** Espelha a prioridade do ViewerShell sem montar React. */
function pickMockupKind(meta: {
  foldMockup?: { panels?: unknown[] } | null;
  boxMockup?: { panels?: unknown[]; dimsMm?: unknown } | null;
  spiralMockup?: { pageWidthMm?: number } | null;
  bookMockup?: { lombadaMm?: number } | null;
}): "fold" | "box" | "spiral" | "book" | "none" {
  const isFold = Boolean(meta.foldMockup?.panels?.length);
  const isBox =
    !isFold && Boolean(meta.boxMockup?.panels?.length && meta.boxMockup.dimsMm);
  const isSpiral =
    !isFold && !isBox && Boolean(meta.spiralMockup?.pageWidthMm);
  const isBook =
    !isFold &&
    !isBox &&
    !isSpiral &&
    Boolean(meta.bookMockup) &&
    (meta.bookMockup?.lombadaMm ?? 0) > 0;
  if (isFold) return "fold";
  if (isBox) return "box";
  if (isSpiral) return "spiral";
  if (isBook) return "book";
  return "none";
}

describe("viewer mockup priority with box", () => {
  it("fold vence box", () => {
    expect(
      pickMockupKind({
        foldMockup: { panels: [{}] },
        boxMockup: { panels: [{}], dimsMm: { length: 1 } },
      }),
    ).toBe("fold");
  });

  it("box vence espiral e livro", () => {
    expect(
      pickMockupKind({
        boxMockup: { panels: [{}], dimsMm: { length: 100 } },
        spiralMockup: { pageWidthMm: 210 },
        bookMockup: { lombadaMm: 8 },
      }),
    ).toBe("box");
  });
});

describe("resolveFlapProgress", () => {
  it("abre por order", () => {
    const map = resolveFlapProgress(
      [
        { id: "a", panelId: "lid_top", order: 1, targetAngleDeg: 120 },
        { id: "b", panelId: "dust", order: 2, targetAngleDeg: 100 },
      ],
      0.25,
    );
    expect(map.get("lid_top")).toBeGreaterThan(0);
    expect(map.get("lid_top")).toBeLessThanOrEqual(1);
    expect(map.get("dust") ?? 0).toBe(0);
  });

  it("totalmente aberto", () => {
    const map = resolveFlapProgress(
      [
        { id: "a", panelId: "lid_top", order: 1, targetAngleDeg: 120 },
        { id: "b", panelId: "dust", order: 2, targetAngleDeg: 100 },
      ],
      1,
    );
    expect(map.get("lid_top")).toBe(1);
    expect(map.get("dust")).toBe(1);
  });
});

describe("defaultCaixaCrop", () => {
  it("defaults model e graph", () => {
    const c = defaultCaixaCrop("model");
    expect(c.sourceKind).toBe("model");
    expect(c.template).toBe("graph");
    expect(c.dimsMm.height).toBeGreaterThan(0);

    const s = defaultCaixaCrop("separate");
    expect(s.sourceKind).toBe("separate");
  });
});

describe("pdfSourcesFromRecord caixa", () => {
  it("model vs separate", () => {
    expect(
      pdfSourcesFromRecord({
        modo: "caixa",
        arquivoUnico: "arte.pdf",
        arquivoCapa: null,
        arquivoMiolo: null,
        pontoRegistro: null,
        dataRegistro: null,
        dataAtualizacao: null,
        cropJson: { caixa: defaultCaixaCrop("model") },
      }),
    ).toEqual([{ id: "unico", label: "Arte", path: "arte.pdf" }]);

    expect(
      pdfSourcesFromRecord({
        modo: "caixa",
        arquivoUnico: null,
        arquivoCapa: "faca.pdf",
        arquivoMiolo: "arte.pdf",
        pontoRegistro: null,
        dataRegistro: null,
        dataAtualizacao: null,
        cropJson: { caixa: defaultCaixaCrop("separate") },
      }),
    ).toEqual([
      { id: "capa", label: "Faca", path: "faca.pdf" },
      { id: "miolo", label: "Arte", path: "arte.pdf" },
    ]);
  });
});
