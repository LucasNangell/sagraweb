import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";

import {
  formatQueueDisplayLabel,
  formatQueueDisplaySituacao,
  matchesColumnStatus,
  mergeDashboardQueueSources,
  mergePcpOrderIntoItems,
  osBelongsToDashboardSector,
  removeOsKeysFromMap,
} from "./utils";

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
