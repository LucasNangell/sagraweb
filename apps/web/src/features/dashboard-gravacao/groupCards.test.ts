import { describe, expect, it } from "vitest";

import {
  areAllChapasSelected,
  cardFornecedorChapaBadges,
  cardUniqueKey,
  displayChapasQty,
  formatGravacaoCardTitle,
  isSaidaParcialSituacao,
  isSaidaTotalSituacao,
  toDisplayColumns,
  wouldSelectAllMaquinas,
} from "./groupCards";
import type { GravacaoBoardCard, GravacaoBoardResponse } from "./types";

function card(nrOs: number, sessions: GravacaoBoardCard["sessions"]): GravacaoBoardCard {
  return { nr_os: nrOs, ano: 2026, sessions };
}

describe("toDisplayColumns", () => {
  it("coloca a mesma OS em duas colunas com uniqueKeys distintos", () => {
    const board: GravacaoBoardResponse = {
      columns: {
        saida_grav_ext: [
          card(1001, [
            {
              gravacao_externa_id: 1,
              fornecedor_nome: "Alfa",
              status: "pendente",
              chapas_por_maquina: [{ maquina: "Komori", quantidade: 3 }],
            },
          ]),
        ],
        grav_concluida: [
          card(1001, [
            {
              gravacao_externa_id: 2,
              fornecedor_nome: "Zeta",
              status: "concluida",
              chapas_por_maquina: [
                { maquina: "SM74", quantidade: 2, quantidade_restante: 2 },
              ],
            },
          ]),
        ],
      },
    };
    const columns = toDisplayColumns(board);
    const saida = columns.find((c) => c.id === "saida_grav_ext");
    const concluida = columns.find((c) => c.id === "grav_concluida");
    expect(saida?.items).toHaveLength(1);
    expect(concluida?.items).toHaveLength(1);
    expect(saida?.items[0]?.nr_os).toBe(1001);
    expect(concluida?.items[0]?.nr_os).toBe(1001);
    expect(saida?.items[0]?.uniqueKey).toBe("1001-2026-saida_grav_ext");
    expect(concluida?.items[0]?.uniqueKey).toBe("1001-2026-grav_concluida");
    expect(saida?.items[0]?.uniqueKey).not.toBe(concluida?.items[0]?.uniqueKey);
  });

  it("gera as quatro colunas mesmo vazias", () => {
    const columns = toDisplayColumns({ columns: {} });
    expect(columns.map((c) => c.id)).toEqual([
      "grav_pendente",
      "saida_grav_ext",
      "recebido_grav_ext",
      "grav_concluida",
    ]);
    expect(columns.every((c) => c.items.length === 0)).toBe(true);
  });
});

describe("cardUniqueKey", () => {
  it("inclui a coluna", () => {
    expect(cardUniqueKey({ nr_os: 10, ano: 2026 }, "grav_pendente")).toBe(
      "10-2026-grav_pendente",
    );
  });

  it("usa o grupo da juntada quando houver", () => {
    expect(
      cardUniqueKey(
        { nr_os: 10, ano: 2026, juntada_grupo_id: "abc" },
        "grav_pendente",
      ),
    ).toBe("j-abc-grav_pendente");
  });
});

describe("formatGravacaoCardTitle", () => {
  it("mantém o rótulo simples de uma OS", () => {
    expect(formatGravacaoCardTitle({ nr_os: 6137, ano: 2026 })).toEqual({
      label: "SP 6137/26",
      tooltip: "SP 6137/26",
    });
  });

  it("lista SPs compactas na juntada e o tooltip completo", () => {
    expect(
      formatGravacaoCardTitle({
        nr_os: 6129,
        ano: 2026,
        membros: [
          { nr_os: 6137, ano: 2026 },
          { nr_os: 6129, ano: 2026 },
          { nr_os: 6101, ano: 2026 },
        ],
      }),
    ).toEqual({
      label: "SPs 6101,6129,6137",
      tooltip: "SP 6101/26, SP 6129/26, SP 6137/26",
    });
  });
});

describe("displayChapasQty", () => {
  it("usa restante quando informado", () => {
    expect(displayChapasQty({ quantidade: 10, quantidade_restante: 4 })).toBe(4);
  });

  it("usa quantidade original sem restante", () => {
    expect(displayChapasQty({ quantidade: 7 })).toBe(7);
  });
});

describe("cardFornecedorChapaBadges", () => {
  it("gera um badge por fornecedor com todas as máquinas", () => {
    const badges = cardFornecedorChapaBadges({
      sessions: [
        {
          fornecedor_nome: "Alfa",
          fornecedor_ponto: "111",
          chapas_por_maquina: [
            { maquina: "Komori", quantidade: 3 },
            { maquina: "SM74", quantidade: 2 },
          ],
        },
        {
          fornecedor_nome: "Zeta",
          fornecedor_ponto: "222",
          chapas_por_maquina: [{ maquina: "PM52", quantidade: 1 }],
        },
      ],
    });
    expect(badges.map((b) => b.label)).toEqual([
      "Alfa · Komori: 3 · SM74: 2",
      "Zeta · PM52: 1",
    ]);
  });

  it("agrega sessões do mesmo fornecedor num único badge", () => {
    const badges = cardFornecedorChapaBadges({
      sessions: [
        {
          fornecedor_nome: "Alfa",
          fornecedor_ponto: "111",
          chapas_por_maquina: [{ maquina: "Komori", quantidade: 3 }],
        },
        {
          fornecedor_nome: "Alfa",
          fornecedor_ponto: "111",
          chapas_por_maquina: [{ maquina: "SM74", quantidade: 1 }],
        },
      ],
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Alfa · Komori: 3 · SM74: 1");
  });
});

describe("isSaidaTotalSituacao", () => {
  it("reconhece Saída p/ e ignora Saída parcial p/", () => {
    expect(isSaidaTotalSituacao("Saída p/")).toBe(true);
    expect(isSaidaTotalSituacao("Saída parcial p/")).toBe(false);
    expect(isSaidaTotalSituacao("Recebido")).toBe(false);
  });
});

describe("isSaidaParcialSituacao", () => {
  it("reconhece só Saída parcial p/", () => {
    expect(isSaidaParcialSituacao("Saída parcial p/")).toBe(true);
    expect(isSaidaParcialSituacao("Saída p/")).toBe(false);
  });
});

describe("areAllChapasSelected", () => {
  const keys = ["1|Komori", "1|SM74"];
  const max = { "1|Komori": 3, "1|SM74": 2 };

  it("é verdadeiro só com todas as máquinas e quantidades completas", () => {
    expect(
      areAllChapasSelected(keys, new Set(keys), { "1|Komori": 3, "1|SM74": 2 }, max),
    ).toBe(true);
    expect(
      areAllChapasSelected(keys, new Set(["1|Komori"]), { "1|Komori": 3, "1|SM74": 2 }, max),
    ).toBe(false);
    expect(
      areAllChapasSelected(keys, new Set(keys), { "1|Komori": 2, "1|SM74": 2 }, max),
    ).toBe(false);
  });

  it("é falso sem máquinas", () => {
    expect(areAllChapasSelected([], new Set(), {}, {})).toBe(false);
  });
});

describe("wouldSelectAllMaquinas", () => {
  const keys = ["1|Komori", "1|SM74"];

  it("é verdadeiro só ao marcar a última máquina que faltava", () => {
    expect(wouldSelectAllMaquinas(keys, new Set(["1|Komori"]), "1|SM74")).toBe(true);
    expect(wouldSelectAllMaquinas(keys, new Set(), "1|Komori")).toBe(false);
    expect(wouldSelectAllMaquinas(["1|Komori"], new Set(), "1|Komori")).toBe(true);
  });
});
