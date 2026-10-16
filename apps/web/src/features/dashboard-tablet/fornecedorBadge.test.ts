import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";

import { resolveOsFornecedorBadges } from "./fornecedorBadge";

function item(partial: Partial<PcpQueueItem>): PcpQueueItem {
  return {
    nr_os: 1,
    ano: 2026,
    ...partial,
  };
}

describe("resolveOsFornecedorBadges", () => {
  it("retorna vazio fora de Grav. Externa / Ext. Concluída", () => {
    expect(
      resolveOsFornecedorBadges(
        item({
          setor: "SEFOC",
          situacao: "Em Execução",
          fornecedor_nome: "Alfa",
        }),
      ),
    ).toEqual([]);
  });

  it("usa lista de fornecedores distintos", () => {
    expect(
      resolveOsFornecedorBadges(
        item({
          setor: "Grav. Externa",
          fornecedores: [
            { ponto: "1", nome: "Alfa" },
            { ponto: "2", nome: "Beta" },
            { ponto: "1", nome: "Alfa" },
          ],
        }),
      ),
    ).toEqual(["Alfa", "Beta"]);
  });

  it("mostra badge em Gravação Ext. Concluída mesmo fora do setor Grav. Externa", () => {
    expect(
      resolveOsFornecedorBadges(
        item({
          setor: "SEGEP",
          situacao: "Gravação Ext. Concluída",
          fornecedores: [
            { ponto: "1", nome: "Alfa" },
            { ponto: "2", nome: "Beta" },
          ],
        }),
      ),
    ).toEqual(["Alfa", "Beta"]);
  });

  it("fallback para ponto/nome únicos", () => {
    expect(
      resolveOsFornecedorBadges(
        item({
          setor: "Grav. Externa",
          fornecedor_ponto: "918.713",
          fornecedor_nome: null,
        }),
      ),
    ).toEqual(["918.713"]);
  });

  it("sem dados não mostra badge", () => {
    expect(
      resolveOsFornecedorBadges(item({ setor: "Grav. Externa" })),
    ).toEqual([]);
  });
});
