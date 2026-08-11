import { describe, expect, it } from "vitest";

import type { AnaliseLabItem } from "@/api/analiseLab";

import { labItemsToClientItems } from "./analiseLabClientPreview";

function sampleItem(partial: Partial<AnaliseLabItem> & { id: number }): AnaliseLabItem {
  return {
    id: partial.id,
    sessaoId: 1,
    titulo: partial.titulo ?? "T",
    htmlSnapshot: partial.htmlSnapshot ?? "<p>x</p>",
    obs: partial.obs ?? null,
    componente: partial.componente ?? "Miolo",
    escopo: partial.escopo ?? "pagina",
    pagina: partial.pagina ?? 1,
    paginas: partial.paginas ?? null,
    versaoLabel: "v1",
    ordem: 0,
    resolucaoObrigatoria: partial.resolucaoObrigatoria ?? false,
    ...partial,
  };
}

describe("labItemsToClientItems", () => {
  it("mapeia campos e aplica desconsideração local", () => {
    const items = [
      sampleItem({ id: 10, titulo: "Sangria", resolucaoObrigatoria: true }),
      sampleItem({ id: 11, titulo: "Texto", componente: "Capa" }),
    ];
    const mapped = labItemsToClientItems(items, {
      disregardedIds: new Set([11]),
    });
    expect(mapped[0]).toMatchObject({
      uniqueId: 10,
      titulo: "Sangria",
      resolucaoObrigatoria: true,
      desconsiderado: false,
      componenteOrigem: "Miolo",
    });
    expect(mapped[1]?.desconsiderado).toBe(true);
  });

  it("marca resolver quando componente teve upload local", () => {
    const items = [sampleItem({ id: 1, componente: "Miolo" })];
    const mapped = labItemsToClientItems(items, {
      uploadedComponents: new Set(["Miolo"]),
    });
    expect(mapped[0]?.resolver).toBe(true);
  });
});
