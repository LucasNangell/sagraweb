import { describe, expect, it } from "vitest";

import type { PcpQueueItem } from "@/api/pcp";
import type {
  DashboardConfig,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";
import { processDashboardData } from "@/features/dashboard-setor/utils";

const config: DashboardConfig = {
  sector: "SEFOC",
  columnCount: 2,
  columns: [
    { id: "entrada", title: "Entrada", statuses: ["Entrada Inicial"] },
    { id: "execucao", title: "Execução", statuses: ["Em Execução"] },
  ],
};
const op: PcpQueueItem = {
  nr_os: 100,
  ano: 2026,
  setor: "SEFOC",
  situacao: "Entrada Inicial",
};

function setup(initial: PcpQueueItem[] = [op], boardConfig = config) {
  const master = new Map<string, DashboardOsItem>();
  const process = (items: PcpQueueItem[], isInitialLoad = false) =>
    processDashboardData(items, boardConfig, master, { isInitialLoad });
  const first = process(initial, true);
  return { process, first };
}

describe("chegadas ao setor", () => {
  it("mantém a carga inicial e suas parciais silenciosas", () => {
    const { first, process } = setup();
    expect(first.hasSectorArrivals).toBe(false);
    expect(process([op, { ...op, nr_os: 101 }], true).hasSectorArrivals).toBe(
      false,
    );
  });

  it("muda de coluna com destaque visual, sem chegada ao setor", () => {
    const { process } = setup();
    const next = process([{ ...op, situacao: "Em Execução" }]);
    expect(next.hasNewItems).toBe(true);
    expect(next.hasSectorArrivals).toBe(false);
  });

  it("não confunde uma situação antes não mapeada com chegada ao setor", () => {
    const { process } = setup([{ ...op, situacao: "Comentário" }]);
    expect(process([op]).hasSectorArrivals).toBe(false);
  });

  it("avisa uma vez por atualização com novas OSs, inclusive em situação não mapeada", () => {
    const { process } = setup();
    const batch = [
      op,
      { ...op, nr_os: 101 },
      { ...op, nr_os: 102, situacao: "Comentário" },
    ];
    expect(process(batch).hasSectorArrivals).toBe(true);
    expect(process(batch).hasSectorArrivals).toBe(false);
  });

  it("ignora prioridade, horário, autor e reorganização dos cards", () => {
    const { process } = setup();
    expect(
      process([
        {
          ...op,
          prioridade: "Prometido p/",
          last_update: "2026-10-21 10:00:00",
          andamento_usuario: "Ana",
          pcp_ordem: 1,
        },
      ]).hasSectorArrivals,
    ).toBe(false);
  });

  it("não repete o aviso ao aparecer outro componente da mesma OS no mesmo setor", () => {
    const sub = {
      ...op,
      row_kind: "sub_os" as const,
      parent_nr_os: 6000,
      parent_ano: 2026,
      sub_os_id: 1,
    };
    const { process } = setup([sub]);
    expect(process([sub, { ...sub, sub_os_id: 2 }]).hasSectorArrivals).toBe(
      false,
    );
  });

  it("avisa novamente quando a OS sai e retorna ao setor", () => {
    const { process } = setup();
    expect(process([]).hasSectorArrivals).toBe(false);
    expect(process([op]).hasSectorArrivals).toBe(true);
  });

  it("reconhece a chegada a outro setor configurado em uma coluna", () => {
    const { process } = setup([op], {
      ...config,
      columns: [
        ...config.columns,
        {
          id: "sepac",
          title: "SEPAC",
          sector: "SEPAC",
          statuses: ["Entrada Inicial"],
        },
      ],
    });
    expect(process([{ ...op, setor: "SEPAC" }]).hasSectorArrivals).toBe(true);
  });

  it("reconhece entrada na Gravação pelo andamento, mesmo com setor físico SEFOC", () => {
    const { process } = setup([], { ...config, sector: "Gravação" });
    expect(process([{ ...op, situacao: "Gravação" }]).hasSectorArrivals).toBe(
      true,
    );
    expect(
      process([{ ...op, situacao: "Gravação Parcial" }]).hasSectorArrivals,
    ).toBe(false);
  });
});
