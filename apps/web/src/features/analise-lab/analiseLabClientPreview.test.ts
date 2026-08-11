import { describe, expect, it } from "vitest";

import type { AnaliseLabItem } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

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

const pages = [
  { page: 1, role: "cover-front", width: 1, height: 1, widthPt: 1, heightPt: 1 },
  { page: 2, role: "page", width: 1, height: 1, widthPt: 1, heightPt: 1 },
  { page: 3, role: "page", width: 1, height: 1, widthPt: 1, heightPt: 1 },
] as ProvaWebPageMeta[];

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

  it("expande item multi-componente em uma entrada por home", () => {
    const items = [
      sampleItem({
        id: 7,
        titulo: "Multi",
        componente: "Miolo",
        escopo: "paginas",
        pagina: 1,
        paginas: "1-3",
      }),
    ];
    const mapped = labItemsToClientItems(items, {
      pages,
      modo: "capa_miolo",
      uploadedComponents: new Set(["Capa"]),
    });
    expect(mapped).toHaveLength(2);
    expect(mapped.map((m) => m.componenteOrigem).sort()).toEqual([
      "Capa",
      "Miolo",
    ]);
    expect(mapped.every((m) => m.uniqueId === 7)).toBe(true);
    const capa = mapped.find((m) => m.componenteOrigem === "Capa");
    const miolo = mapped.find((m) => m.componenteOrigem === "Miolo");
    expect(capa?.resolver).toBe(true);
    expect(miolo?.resolver).toBe(false);
  });
});
