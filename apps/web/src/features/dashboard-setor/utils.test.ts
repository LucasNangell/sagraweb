import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";

import {
  collectDashboardSectors,
  formatQueueDisplayLabel,
  formatQueueDisplaySituacao,
  getVisibleDashboardColumns,
  hashDashboardBoard,
  hashDashboardItems,
  matchesColumnStatus,
  mergeDashboardQueueSources,
  mergePcpOrderIntoItems,
  osBelongsToDashboardSector,
  processDashboardData,
  removeOsKeysFromMap,
  resolveColumnSector,
} from "./utils";
import type { DashboardConfig, DashboardDisplayColumn } from "./types";

const subOs: PcpQueueItem = {
  nr_os: 568,
  ano: 2026,
  row_kind: "sub_os",
  sub_os_id: 1,
  parent_nr_os: 568,
  parent_ano: 2026,
  componente_nome: "Miolo",
  situacao: "Em Execução",
};

describe("autor do andamento no painel", () => {
  it("atualiza o autor mesmo quando a situação e o horário continuam iguais", () => {
    const config: DashboardConfig = {
      sector: "SEFOC",
      columnCount: 1,
      columns: [{ id: "exec", title: "Execução", statuses: ["Em Execução"] }],
    };
    const raw: PcpQueueItem = {
      nr_os: 1428,
      ano: 2026,
      setor: "SEFOC",
      situacao: "Em Execução",
      last_update: "2026-10-21 12:00:00",
      andamento_usuario: "Ana Silva",
    };
    const master = new Map();
    const first = processDashboardData([raw], config, master, {
      isInitialLoad: true,
    });
    const signature = hashDashboardBoard(first.columns);
    const changed = { ...raw, andamento_usuario: "Carlos Lima" };
    expect(hashDashboardItems([raw])).not.toBe(hashDashboardItems([changed]));
    const next = processDashboardData([changed], config, master, {
      isInitialLoad: true,
    });
    expect(next.columns[0]?.items[0]?.andamento_usuario).toBe("Carlos Lima");
    expect(hashDashboardBoard(next.columns)).not.toBe(signature);
  });
});

describe("matchesColumnStatus", () => {
  it("Gravação não captura Gravação Pendente/Externa/Parcial", () => {
    expect(matchesColumnStatus("Gravação", "Gravação")).toBe(true);
    expect(matchesColumnStatus("Gravação Pendente", "Gravação")).toBe(false);
    expect(matchesColumnStatus("Gravação Externa", "Gravação")).toBe(false);
    expect(matchesColumnStatus("Gravação Parcial", "Gravação")).toBe(false);
  });

  it("prefixos de destino ainda batem o valor completo", () => {
    expect(matchesColumnStatus("Saída p/", "Saída p/")).toBe(true);
    expect(matchesColumnStatus("Saída p/ SEFOC", "Saída p/")).toBe(true);
    expect(matchesColumnStatus("Tramit. de Prova p/ SEPAC", "Tramit. de Prova p/")).toBe(
      true,
    );
    expect(matchesColumnStatus("Recebido", "Saída p/")).toBe(false);
  });

  it("andamentos exactos não usam prefixo solto", () => {
    expect(matchesColumnStatus("Em Execução", "Em Execução")).toBe(true);
    expect(matchesColumnStatus("Recebido", "Recebido")).toBe(true);
    expect(matchesColumnStatus("Em Execução", "Em")).toBe(false);
  });
});

describe("formatQueueDisplayLabel", () => {
  it("Sub OS usa número da OS principal no padrão OS/ano", () => {
    expect(formatQueueDisplayLabel(subOs)).toBe("OS 568/26");
  });

  it("OS normal inalterada", () => {
    expect(
      formatQueueDisplayLabel({ nr_os: 568, ano: 2026, situacao: "Em Execução" }),
    ).toBe("OS 568/26");
  });
});

describe("formatQueueDisplaySituacao", () => {
  it("Sub OS prefixa componente antes da situação", () => {
    expect(formatQueueDisplaySituacao(subOs)).toBe("[Miolo] Em Execução");
  });

  it("não duplica prefixo se situação já contém componente", () => {
    expect(
      formatQueueDisplaySituacao({
        ...subOs,
        situacao: "[Miolo] Em Execução",
      }),
    ).toBe("[Miolo] Em Execução");
  });

  it("OS normal retorna só situação", () => {
    expect(
      formatQueueDisplaySituacao({ nr_os: 1, ano: 2026, situacao: "Recebido" }),
    ).toBe("Recebido");
  });
});

describe("mergeDashboardQueueSources", () => {
  it("prioriza OS da busca materializada e enriquece com ordem PCP", () => {
    const searchItems: PcpQueueItem[] = [
      { nr_os: 100, ano: 2026, situacao: "Recebido", setor: "SEFOC" },
      { nr_os: 200, ano: 2026, situacao: "Em Execução", setor: "SEFOC" },
    ];
    const pcpItems: PcpQueueItem[] = [
      {
        nr_os: 100,
        ano: 2026,
        situacao: "Recebido",
        setor: "SEFOC",
        pcp_ordem: 2,
      },
    ];

    const merged = mergeDashboardQueueSources(searchItems, pcpItems);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      nr_os: 100,
      situacao: "Recebido",
      pcp_ordem: 2,
    });
    expect(merged[1]).toMatchObject({ nr_os: 200, situacao: "Em Execução" });
  });

  it("preserva cards Sub OS exclusivos da fila PCP", () => {
    const searchItems: PcpQueueItem[] = [
      { nr_os: 568, ano: 2026, situacao: "Em Execução", setor: "SEFOC" },
    ];
    const pcpItems: PcpQueueItem[] = [
      ...searchItems,
      {
        ...subOs,
        pcp_ordem: 1,
      },
    ];

    const merged = mergeDashboardQueueSources(searchItems, pcpItems);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      row_kind: "sub_os",
      sub_os_id: 1,
      pcp_ordem: 1,
    });
  });
});

describe("osBelongsToDashboardSector", () => {
  it("exclui finalizadas", () => {
    expect(
      osBelongsToDashboardSector(
        { nr_os: 1, ano: 2026, situacao: "Entregue", setor: "SEFOC" },
        "SEFOC",
      ),
    ).toBe(false);
  });

  it("Gravação filtra por situação", () => {
    expect(
      osBelongsToDashboardSector(
        { nr_os: 1, ano: 2026, situacao: "Gravação", setor: "SEFOC" },
        "Gravação",
      ),
    ).toBe(true);
    expect(
      osBelongsToDashboardSector(
        { nr_os: 1, ano: 2026, situacao: "Em Execução", setor: "SEFOC" },
        "Gravação",
      ),
    ).toBe(false);
  });
});

describe("removeOsKeysFromMap", () => {
  it("remove OS principal e Sub OS do mapa", () => {
    const map = new Map<string, PcpQueueItem>([
      ["100-2026", { nr_os: 100, ano: 2026, situacao: "Recebido" }],
      ["100-2026-sub-1", { ...subOs, nr_os: 100, ano: 2026 }],
      ["200-2026", { nr_os: 200, ano: 2026, situacao: "Em Execução" }],
    ]);
    removeOsKeysFromMap(map, 100, 2026);
    expect([...map.keys()]).toEqual(["200-2026"]);
  });
});

describe("mergePcpOrderIntoItems", () => {
  it("atualiza só ordem PCP nos itens existentes", () => {
    const items: PcpQueueItem[] = [
      { nr_os: 100, ano: 2026, situacao: "Recebido", setor: "SEFOC" },
    ];
    const pcp: PcpQueueItem[] = [
      {
        nr_os: 100,
        ano: 2026,
        situacao: "Recebido",
        setor: "SEFOC",
        pcp_ordem: 3,
      },
    ];
    const merged = mergePcpOrderIntoItems(items, pcp);
    expect(merged.items[0].pcp_ordem).toBe(3);
    expect(merged.items[0].situacao).toBe("Recebido");
    expect(merged.changed).toBe(true);
  });
});

describe("resolveColumnSector / collectDashboardSectors", () => {
  it("herda setor do painel quando coluna não tem override", () => {
    expect(resolveColumnSector({}, "SEFOC")).toBe("SEFOC");
    expect(resolveColumnSector({ sector: "  " }, "SEFOC")).toBe("SEFOC");
    expect(resolveColumnSector({ sector: "Papelaria" }, "SEFOC")).toBe(
      "Papelaria",
    );
  });

  it("deduplica board + overrides de coluna", () => {
    const config: DashboardConfig = {
      sector: "SEFOC",
      columnCount: 3,
      columns: [
        { id: "a", title: "A", statuses: ["Recebido"] },
        { id: "b", title: "B", statuses: ["Em Execução"], sector: "Papelaria" },
        { id: "c", title: "C", statuses: ["Pronto"], sector: "SEFOC" },
      ],
    };
    expect(collectDashboardSectors(config)).toEqual(["SEFOC", "Papelaria"]);
  });
});

describe("processDashboardData column sector override", () => {
  const config: DashboardConfig = {
    sector: "SEFOC",
    columnCount: 2,
    columns: [
      {
        id: "sefoca",
        title: "Execução SEFOC",
        statuses: ["Em Execução"],
      },
      {
        id: "papelaria",
        title: "Execução Papelaria",
        statuses: ["Em Execução"],
        sector: "Papelaria",
      },
    ],
  };

  it("coluna sem sector herda e filtra pelo board", () => {
    const raw: PcpQueueItem[] = [
      { nr_os: 1, ano: 2026, situacao: "Em Execução", setor: "SEFOC" },
      { nr_os: 2, ano: 2026, situacao: "Em Execução", setor: "Papelaria" },
    ];
    const processed = processDashboardData(raw, config, new Map(), {
      isInitialLoad: true,
    });
    expect(processed.columns[0]!.items.map((i) => i.nr_os)).toEqual([1]);
    expect(processed.columns[1]!.items.map((i) => i.nr_os)).toEqual([2]);
  });

  it("mesmo andamento não mistura setores entre colunas", () => {
    const raw: PcpQueueItem[] = [
      { nr_os: 10, ano: 2026, situacao: "Em Execução", setor: "Papelaria" },
    ];
    const processed = processDashboardData(raw, config, new Map(), {
      isInitialLoad: true,
    });
    expect(processed.columns[0]!.items).toHaveLength(0);
    expect(processed.columns[1]!.items).toHaveLength(1);
    expect(processed.columns[1]!.title).toBe("Execução Papelaria");
  });
});

describe("processDashboardData ordem OS antes de SP", () => {
  const config: DashboardConfig = {
    sector: "SEFOC",
    columnCount: 1,
    columns: [
      { id: "exec", title: "Execução", statuses: ["Em Execução"] },
    ],
  };

  it("mantém OS acima de SP mesmo com PCP e prioridade da SP", () => {
    const raw: PcpQueueItem[] = [
      {
        nr_os: 5100,
        ano: 2026,
        situacao: "Em Execução",
        setor: "SEFOC",
        pcp_ordem: 0,
        prioridade: "Prometido p/ 10/10",
      },
      {
        nr_os: 200,
        ano: 2026,
        situacao: "Em Execução",
        setor: "SEFOC",
        pcp_ordem: 2,
      },
      {
        nr_os: 5300,
        ano: 2026,
        situacao: "Em Execução",
        setor: "SEFOC",
        prioridade: "Solicitado p/ 12/10",
      },
      {
        nr_os: 100,
        ano: 2026,
        situacao: "Em Execução",
        setor: "SEFOC",
        pcp_ordem: 1,
      },
      {
        nr_os: 5400,
        ano: 2026,
        situacao: "Em Execução",
        setor: "SEFOC",
        prioridade: "Prometido p/ 11/10",
      },
    ];
    const processed = processDashboardData(raw, config, new Map(), {
      isInitialLoad: true,
    });
    expect(processed.columns[0]!.items.map((item) => item.nr_os)).toEqual([
      100,
      200,
      5100,
      5400,
      5300,
    ]);
  });
});

describe("getVisibleDashboardColumns", () => {
  const base = (patch: Partial<DashboardDisplayColumn>): DashboardDisplayColumn => ({
    id: patch.id ?? "col",
    title: patch.title ?? "Coluna",
    statuses: patch.statuses ?? [],
    items: patch.items ?? [],
    hideWhenEmpty: patch.hideWhenEmpty,
    sector: patch.sector,
  });

  it("sem flag permanece mesmo vazia", () => {
    const cols = [base({ id: "a", items: [] })];
    expect(getVisibleDashboardColumns(cols).map((c) => c.id)).toEqual(["a"]);
  });

  it("com flag e vazia é filtrada", () => {
    const cols = [base({ id: "a", hideWhenEmpty: true, items: [] })];
    expect(getVisibleDashboardColumns(cols)).toEqual([]);
  });

  it("com flag e items permanece", () => {
    const cols = [
      base({
        id: "a",
        hideWhenEmpty: true,
        items: [
          {
            nr_os: 1,
            ano: 2026,
            uniqueKey: "1-2026",
            priorityType: null,
            isNew: false,
            displaySituacao: "Recebido",
            pcp_ordem: null,
          },
        ],
      }),
    ];
    expect(getVisibleDashboardColumns(cols).map((c) => c.id)).toEqual(["a"]);
  });

  it("misturado: só elegíveis saem na lista", () => {
    const cols = [
      base({ id: "always", items: [] }),
      base({ id: "hidden", hideWhenEmpty: true, items: [] }),
      base({
        id: "shown",
        hideWhenEmpty: true,
        items: [
          {
            nr_os: 2,
            ano: 2026,
            uniqueKey: "2-2026",
            priorityType: null,
            isNew: false,
            displaySituacao: "Em Execução",
            pcp_ordem: null,
          },
        ],
      }),
    ];
    expect(getVisibleDashboardColumns(cols).map((c) => c.id)).toEqual([
      "always",
      "shown",
    ]);
  });
});
