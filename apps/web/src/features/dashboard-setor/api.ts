import type { PcpQueueItem, PcpQueueResponse } from "@/api/pcp";
import { apiFetch } from "@/lib/api";

import type { OsSearchResponse } from "@/features/os/types";

import { mergeDashboardQueueSources } from "./utils";

/** Evita respostas stale do cache HTTP (PCP envia max-age=8). */
const DASHBOARD_FETCH_INIT: RequestInit = { cache: "no-store" };

type OsSearchRowWithPcp = OsSearchResponse["data"][number] & {
  pcp_ordem?: number | null;
  pcp_ultima_atualizacao?: string | null;
};

function mapSearchRowToQueueItem(row: OsSearchRowWithPcp): PcpQueueItem {
  return {
    nr_os: row.nr_os,
    ano: row.ano,
    titulo: row.titulo,
    produto: row.produto,
    situacao: row.situacao,
    setor: row.setor,
    data_entrega: row.data_entrega,
    entreg_periodo: row.entreg_periodo,
    prioridade: row.prioridade,
    last_update: row.last_update,
    observacao: row.observacao,
    pcp_ordem: row.pcp_ordem ?? null,
    pcp_ultima_atualizacao: row.pcp_ultima_atualizacao ?? null,
  };
}

async function fetchMaterializedDashboardQueue(
  sector: string,
): Promise<PcpQueueItem[]> {
  const isGravacao = sector === "Gravação";
  const params = new URLSearchParams();
  params.append("setor", isGravacao ? "SEFOC" : sector);
  params.append("include_finished", "false");
  params.append("limit", "200");
  params.append("painel", "1");

  const result = await apiFetch<OsSearchResponse>(
    `/os/search?${params}`,
    DASHBOARD_FETCH_INIT,
  );
  let data = (result.data ?? []) as OsSearchRowWithPcp[];

  if (isGravacao) {
    const allowed = new Set(["Gravação", "Gravação Parcial"]);
    data = data.filter((item) => allowed.has(item.situacao ?? ""));
  }

  return data.map(mapSearchRowToQueueItem);
}

export async function fetchPcpQueueForDashboard(
  sector: string,
): Promise<PcpQueueItem[]> {
  const params = new URLSearchParams({ setor: sector, painel: "1" });
  const result = await apiFetch<PcpQueueResponse>(
    `/pcp/queue?${params}`,
    DASHBOARD_FETCH_INIT,
  );
  return result.items ?? [];
}

export type DashboardFetchProgress = (items: PcpQueueItem[]) => void;

/** Lookup pontual de uma OS para patch incremental do painel (sem refetch da fila inteira). */
export async function fetchDashboardOsByKey(
  nrOs: number,
  ano: number,
): Promise<PcpQueueItem | null> {
  const params = new URLSearchParams({
    nr_os: String(nrOs),
    ano: String(ano),
    exact_os_lookup: "true",
    include_finished: "false",
    painel: "1",
    limit: "5",
    simple_pagination: "true",
  });

  const result = await apiFetch<OsSearchResponse>(
    `/os/search?${params}`,
    DASHBOARD_FETCH_INIT,
  );
  const row = (result.data ?? [])[0] as OsSearchRowWithPcp | undefined;
  if (!row) {
    return null;
  }
  return mapSearchRowToQueueItem(row);
}

/**
 * Carrega fila do painel: primeiro /os/search (rápido, materializada), depois
 * /pcp/queue só para ordem PCP (sem previsões ML no backend).
 */
export async function fetchDashboardSectorData(
  sector: string,
  onProgress?: DashboardFetchProgress,
): Promise<PcpQueueItem[]> {
  const searchItems = await fetchMaterializedDashboardQueue(sector);
  onProgress?.(searchItems);

  try {
    const pcpResult = await fetchPcpQueueForDashboard(sector);
    return mergeDashboardQueueSources(searchItems, pcpResult);
  } catch (queueErr) {
    console.warn("[DashboardSetor] Fila PCP indisponível — exibindo só busca:", queueErr);
    return searchItems;
  }
}
