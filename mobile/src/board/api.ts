import { apiFetch } from "@/lib/http";

import { mergeDashboardQueueSources } from "./utils";
import type { PcpQueueItem } from "./types";

const NO_STORE: RequestInit = { cache: "no-store" };

interface OsSearchRow {
  nr_os: number;
  ano: number;
  titulo?: string | null;
  produto?: string | null;
  situacao?: string | null;
  setor?: string | null;
  data_entrega?: string | null;
  entreg_periodo?: string | null;
  prioridade?: string | null;
  last_update?: string | null;
  observacao?: string | null;
  pcp_ordem?: number | null;
  pcp_ultima_atualizacao?: string | null;
}

function mapSearchRowToQueueItem(row: OsSearchRow): PcpQueueItem {
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

async function fetchMaterializedQueue(sector: string): Promise<PcpQueueItem[]> {
  const isGravacao = sector === "Gravação";
  const params = new URLSearchParams();
  params.append("setor", isGravacao ? "SEFOC" : sector);
  params.append("include_finished", "false");
  params.append("limit", "200");
  params.append("painel", "1");

  const result = await apiFetch<{ data?: OsSearchRow[] }>(
    `/os/search?${params}`,
    NO_STORE,
  );
  let data = result.data ?? [];
  if (isGravacao) {
    const allowed = new Set(["Gravação", "Gravação Parcial"]);
    data = data.filter((item) => allowed.has(item.situacao ?? ""));
  }
  return data.map(mapSearchRowToQueueItem);
}

async function fetchPcpQueue(sector: string): Promise<PcpQueueItem[]> {
  const params = new URLSearchParams({ setor: sector, painel: "1" });
  const result = await apiFetch<{ items?: PcpQueueItem[] }>(
    `/pcp/queue?${params}`,
    NO_STORE,
  );
  return result.items ?? [];
}

export async function fetchDashboardQueue(
  sector: string,
): Promise<PcpQueueItem[]> {
  const [searchItems, pcpItems] = await Promise.all([
    fetchMaterializedQueue(sector),
    fetchPcpQueue(sector).catch(() => [] as PcpQueueItem[]),
  ]);
  return mergeDashboardQueueSources(searchItems, pcpItems);
}

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
  const result = await apiFetch<{ data?: OsSearchRow[] }>(
    `/os/search?${params}`,
    NO_STORE,
  );
  const row = (result.data ?? [])[0];
  return row ? mapSearchRowToQueueItem(row) : null;
}

export async function fetchSetores(): Promise<string[]> {
  const rows = await apiFetch<{ Setor?: string }[]>("/aux/setores");
  return rows.map((r) => r.Setor).filter((v): v is string => Boolean(v?.trim()));
}

export async function fetchAndamentos(): Promise<string[]> {
  try {
    const rows = await apiFetch<{ Situacao?: string }[]>("/aux/andamentos");
    return rows
      .map((r) => r.Situacao)
      .filter((v): v is string => Boolean(v?.trim()));
  } catch {
    const rows = await apiFetch<{ Situacao?: string }[]>("/aux/situacoes");
    return rows
      .map((r) => r.Situacao)
      .filter((v): v is string => Boolean(v?.trim()));
  }
}

export async function fetchBoardPreference(): Promise<unknown> {
  const res = await apiFetch<{ payload?: unknown }>(
    "/settings/preferences/painel_setor",
  );
  return res.payload ?? null;
}

export async function fetchSetorPainelDefault(
  setor: string,
): Promise<unknown> {
  const res = await apiFetch<{ payload?: unknown }>(
    `/settings/setor-painel-default/${encodeURIComponent(setor)}`,
  );
  return res.payload ?? null;
}
