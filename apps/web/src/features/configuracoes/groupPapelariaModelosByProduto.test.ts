import { describe, expect, it } from "vitest";

import { groupPapelariaModelosByProduto } from "./groupPapelariaModelosByProduto";
import type { PapelariaAdminModelRecord } from "./types";

function modelo(
  partial: Partial<PapelariaAdminModelRecord> & Pick<PapelariaAdminModelRecord, "id" | "produto">,
): PapelariaAdminModelRecord {
  return {
    frente_versao: "Frente",
    cores: "Policromia",
    arquivo_modelo: `modelo-${partial.id}.cdr`,
    nome_exibicao: partial.produto,
    ...partial,
  };
}

describe("groupPapelariaModelosByProduto", () => {
  it("agrupa por produto, ordena produtos e modelos, e conta mockup/prévia", () => {
    const groups = groupPapelariaModelosByProduto([
      modelo({
        id: 2,
        produto: "Ct Visita",
        ordem: 20,
        tem_mockup_config: true,
        tem_preview_config: true,
      }),
      modelo({
        id: 1,
        produto: "Ct Visita",
        ordem: 10,
        tem_preview_config: true,
      }),
      modelo({ id: 3, produto: "Bloco A5", ordem: 5 }),
    ]);

    expect(groups.map((g) => g.produto)).toEqual(["Bloco A5", "Ct Visita"]);
    expect(groups[0].modelos.map((m) => m.id)).toEqual([3]);
    expect(groups[1].modelos.map((m) => m.id)).toEqual([1, 2]);
    expect(groups[1].comMockup).toBe(1);
    expect(groups[1].comPreview).toBe(2);
  });

  it("trata produto vazio como grupo único", () => {
    const groups = groupPapelariaModelosByProduto([
      modelo({ id: 1, produto: "  " }),
      modelo({ id: 2, produto: "" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].produto).toBe("(sem produto)");
    expect(groups[0].modelos).toHaveLength(2);
  });
});
