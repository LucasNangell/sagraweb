import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";

import {
  applyOsPatchToItemsMap,
  shouldFetchSubOsForEvent,
} from "./dashboardRealtimeSync";

const subOs1: PcpQueueItem = {
  nr_os: 5001,
  ano: 2026,
  row_kind: "sub_os",
  sub_os_id: 1,
  parent_nr_os: 5001,
  parent_ano: 2026,
  situacao: "Em Execução",
  setor: "Papelaria",
};

const subOs2: PcpQueueItem = {
  ...subOs1,
  sub_os_id: 2,
  componente_nome: "Miolo",
};

describe("shouldFetchSubOsForEvent", () => {
  it("inclui Sub OS para SP >= 5000 mesmo sem action sub_os_", () => {
    expect(
      shouldFetchSubOsForEvent({ id: 5001, ano: 2026, action: "history_added" }),
    ).toBe(true);
  });

  it("nao inclui Sub OS para OS reprografica < 5000", () => {
    expect(
      shouldFetchSubOsForEvent({ id: 100, ano: 2026, action: "history_added" }),
    ).toBe(false);
  });

  it("inclui quando sub_os_id presente", () => {
    expect(
      shouldFetchSubOsForEvent({ id: 100, ano: 2026, sub_os_id: 5 }),
    ).toBe(true);
  });
});

describe("applyOsPatchToItemsMap", () => {
  it("patch de uma Sub OS nao remove as demais do mesmo SP", () => {
    const map = new Map<string, PcpQueueItem>([
      ["5001-2026-sub-1", subOs1],
      ["5001-2026-sub-2", subOs2],
      ["100-2026", { nr_os: 100, ano: 2026, situacao: "Recebido", setor: "Papelaria" }],
    ]);

    const updatedSub1: PcpQueueItem = {
      ...subOs1,
      situacao: "Recebido",
    };

    const result = applyOsPatchToItemsMap(
      map,
      "Papelaria",
      5001,
      2026,
      [updatedSub1],
      { subOsId: 1 },
    );

    expect([...result.map.keys()].sort()).toEqual([
      "100-2026",
      "5001-2026-sub-1",
      "5001-2026-sub-2",
    ]);
    expect(result.map.get("5001-2026-sub-1")?.situacao).toBe("Recebido");
    expect(result.map.get("5001-2026-sub-2")).toEqual(subOs2);
  });

  it("aceita item de setor secundário na lista monitorada", () => {
    const map = new Map<string, PcpQueueItem>();
    const incoming: PcpQueueItem = {
      nr_os: 55,
      ano: 2026,
      situacao: "Em Execução",
      setor: "Papelaria",
    };
    const result = applyOsPatchToItemsMap(
      map,
      ["SEFOC", "Papelaria"],
      55,
      2026,
      [incoming],
    );
    expect(result.changed).toBe(true);
    expect(result.map.get("55-2026")?.setor).toBe("Papelaria");
  });

  it("ignora item de setor fora da lista", () => {
    const map = new Map<string, PcpQueueItem>();
    const incoming: PcpQueueItem = {
      nr_os: 55,
      ano: 2026,
      situacao: "Em Execução",
      setor: "SEPAC",
    };
    const result = applyOsPatchToItemsMap(
      map,
      ["SEFOC", "Papelaria"],
      55,
      2026,
      [incoming],
    );
    expect(result.map.size).toBe(0);
  });
});
