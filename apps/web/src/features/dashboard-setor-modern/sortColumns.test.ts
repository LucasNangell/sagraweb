import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";
import type {
  DashboardConfig,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";
import {
  hashDashboardBoard,
  hashDashboardItems,
  processDashboardData,
} from "@/features/dashboard-setor/utils";

import { sortModernDashboardColumns } from "./sortColumns";

const config: DashboardConfig = {
  sector: "SEFOC",
  columnCount: 1,
  columns: [{ id: "exec", title: "Execução", statuses: ["Em Execução"] }],
};

function item(
  nr_os: number,
  prioridade: string | null = null,
  last_update: string | null = "2026-10-21 10:00:00",
  pcp_ordem = nr_os,
): PcpQueueItem {
  return {
    nr_os,
    ano: 2026,
    prioridade,
    last_update,
    pcp_ordem,
    setor: "SEFOC",
    situacao: "Em Execução",
  };
}

function board(
  items: PcpQueueItem[],
  master = new Map<string, DashboardOsItem>(),
) {
  return processDashboardData(items, config, master, { isInitialLoad: true })
    .columns;
}

function numbers(items: PcpQueueItem[]) {
  return sortModernDashboardColumns(board(items))[0]!.items.map(
    (op) => op.nr_os,
  );
}

describe("ordenação do painel moderno", () => {
  it("usa a hora da observação e publica alterações isoladas nesse horário", () => {
    const master = new Map<string, DashboardOsItem>();
    const initial = [
      item(101, null, "2026-10-22 10:00:00", 1),
      {
        ...item(102, null, "2026-10-22 00:00:00", 0),
        observacao: "11h00\nRecebido",
      },
    ];
    const first = board(initial, master);
    const signature = hashDashboardBoard(first);
    expect(
      sortModernDashboardColumns(first)[0]!.items.map((op) => op.nr_os),
    ).toEqual([101, 102]);
    const updated = [
      initial[0]!,
      { ...initial[1]!, observacao: "09h00\nRecebido" },
    ];
    expect(hashDashboardItems(updated)).not.toBe(hashDashboardItems(initial));
    const next = board(updated, master);
    expect(hashDashboardBoard(next)).not.toBe(signature);
    expect(
      sortModernDashboardColumns(next)[0]!.items.map((op) => op.nr_os),
    ).toEqual([102, 101]);
  });

  it("mantém OS antes de SP, com Prometido, Solicitado e normal em cada grupo", () => {
    expect(
      numbers([
        item(6001, "Prometido p/ 22/10", undefined, 0),
        item(103, null, undefined, 1),
        item(6003, null, undefined, 2),
        item(102, "Solicitado p/ 22/10", undefined, 3),
        item(6002, "Solicitado p/ 22/10", undefined, 4),
        item(101, "Prometido p/ 22/10", undefined, 5),
      ]),
    ).toEqual([101, 102, 103, 6001, 6002, 6003]);
  });

  it.each(["Prometido p/", "Solicitado p/", null])(
    "ordena %s pelo maior tempo no andamento, mesmo com PCP em ordem contrária",
    (priority) => {
      expect(
        numbers([
          item(101, priority, "2026-10-21T14:00:00Z", 0),
          item(102, priority, "2026-10-21 09:00:00", 2),
          item(103, priority, "2026-10-21T10:00:00-03:00", 1),
        ]),
      ).toEqual([102, 103, 101]);
    },
  );

  it("classifica Sub OS pelo protocolo pai e mantém 5000 no grupo SP", () => {
    expect(
      numbers([
        {
          ...item(1, "Prometido p/"),
          row_kind: "sub_os",
          sub_os_id: 1,
          parent_nr_os: 6000,
        },
        item(5000, "Solicitado p/"),
        item(4999),
      ]),
    ).toEqual([4999, 1, 5000]);
  });

  it("coloca horários desconhecidos após os conhecidos sem ultrapassar prioridades", () => {
    expect(
      numbers([
        item(103, null, "inválido"),
        item(102, null, null),
        item(101),
        item(104, "Prometido p/", null),
      ]),
    ).toEqual([104, 101, 102, 103]);
  });

  it("mantém e-mails da caixa de entrada do mais recente para o mais antigo", () => {
    const inboxConfig: DashboardConfig = {
      sector: "SEFOC",
      columnCount: 1,
      columns: [
        { id: "inbox", title: "Novo e-mail", statuses: [], source: "inbox" },
      ],
    };
    const columns = processDashboardData([], inboxConfig, new Map(), {
      isInitialLoad: true,
      inboxOs: [
        { os: 10, ano: 2026, date: "2026-10-21T08:00:00Z" },
        { os: 20, ano: 2026, date: "2026-10-22T12:00:00Z" },
      ],
    }).columns;
    expect(
      sortModernDashboardColumns(columns)[0]!.items.map((op) => op.nr_os),
    ).toEqual([20, 10]);
  });

  it("preserva a sequência original do PCP e os metadados das colunas", () => {
    const original = board([
      item(102, null, undefined, 0),
      item(101, "Prometido p/", undefined, 1),
    ]);
    const sorted = sortModernDashboardColumns(original);
    expect(original[0]!.items.map((op) => op.nr_os)).toEqual([102, 101]);
    expect(sorted[0]!.items.map((op) => op.nr_os)).toEqual([101, 102]);
    expect(sorted[0]).toMatchObject(config.columns[0]!);
  });

  it.each([
    { prioridade: "Prometido p/" },
    { last_update: "2026-10-21 08:00:00" },
  ])("publica e reordena atualizações isoladas de %j", (patch) => {
    const master = new Map<string, DashboardOsItem>();
    const initial = [item(101), item(102)];
    const first = board(initial, master);
    const signature = hashDashboardBoard(first);
    const updated = [initial[0]!, { ...initial[1]!, ...patch }];
    expect(hashDashboardItems(updated)).not.toBe(hashDashboardItems(initial));
    const next = board(updated, master);
    expect(hashDashboardBoard(next)).not.toBe(signature);
    expect(
      sortModernDashboardColumns(next)[0]!.items.map((op) => op.nr_os),
    ).toEqual([102, 101]);
  });
});
