import { apiFetch } from "@/lib/api";

import type { CotasGrafSearchFilters } from "@/features/cotas-graf/types";

export interface CotasGrafItem {
  nr_os: number;
  ano: number;
  produto?: string | null;
  solicitante?: string | null;
  titulo?: string | null;
  cotas_graf_atualizado: boolean;
}

export interface CotasGrafListResponse {
  items: CotasGrafItem[];
  total: number;
  limit: number;
  offset: number;
  page: number;
}

function appendList(params: URLSearchParams, key: string, values: string[]) {
  for (const value of values) {
    if (value.trim()) {
      params.append(key, value.trim());
    }
  }
}

export function buildCotasGrafQueryString(
  filters: CotasGrafSearchFilters,
  options?: { includePagination?: boolean },
): string {
  const params = new URLSearchParams();
  const includePagination = options?.includePagination ?? true;

  if (filters.nrOs != null && !Number.isNaN(filters.nrOs)) {
    params.append("nr_os", String(filters.nrOs));
  }
  if (filters.ano != null && !Number.isNaN(filters.ano)) {
    params.append("ano", String(filters.ano));
    params.append("ano_mode", filters.anoMode ?? "specific");
  }
  if (filters.produtos.length > 0) {
    appendList(params, "produtos", filters.produtos);
  } else if (filters.produto?.trim()) {
    params.append("produto", filters.produto.trim());
  }
  if (filters.titulo?.trim()) {
    params.append("titulo", filters.titulo.trim());
  }
  if (filters.solicitantes.length > 0) {
    appendList(params, "solicitantes", filters.solicitantes);
  } else if (filters.solicitante?.trim()) {
    params.append("solicitante", filters.solicitante.trim());
  }
  appendList(params, "situacao_cotas", filters.situacaoCotas);

  params.append("include_finished", String(filters.includeFinished));
  params.append("include_os", String(filters.includeOs));
  params.append("include_sp", String(filters.includeSp));
  if (includePagination) {
    params.append("page", String(filters.page));
    params.append("limit", String(filters.limit));
  }

  return params.toString();
}

export interface CotasGrafSolicitanteCotasItem {
  solicitante?: string | null;
  categoria?: string | null;
  cod_usuario?: string | null;
  nome_usuario?: string | null;
  consumo_os: number;
  limite_os?: number | null;
  saldo_os?: number | null;
  consumo_sp: number;
  limite_sp?: number | null;
  saldo_sp?: number | null;
  semestre_ano?: number | null;
  semestre_numero?: number | null;
}

export interface CotasGrafSolicitantesCotasResponse {
  items: CotasGrafSolicitanteCotasItem[];
  total: number;
  semestre_ano?: number | null;
  semestre_numero?: number | null;
}

export interface CotasGrafConsumoHistoricoItem {
  nr_os: number;
  ano: number;
  tipo: string;
  produto?: string | null;
  titulo?: string | null;
  cota_consumida: number;
  data_entrada?: string | null;
  origem?: string | null;
  referencia_externa?: string | null;
}

export interface CotasGrafConsumoHistoricoResponse {
  items: CotasGrafConsumoHistoricoItem[];
  total: number;
}

export interface CotasGrafSolicitanteClienteKey {
  cod_usuario: string;
  categoria: string;
  nome_usuario: string;
}

export async function fetchCotasGrafSolicitantesCotas(
  filters: CotasGrafSearchFilters,
): Promise<CotasGrafSolicitantesCotasResponse> {
  const qs = buildCotasGrafQueryString(filters, { includePagination: false });
  return apiFetch<CotasGrafSolicitantesCotasResponse>(
    `/cotas-graf/solicitantes-cotas?${qs}`,
  );
}

export async function fetchSolicitanteConsumoHistorico(
  cliente: CotasGrafSolicitanteClienteKey,
): Promise<CotasGrafConsumoHistoricoResponse> {
  const params = new URLSearchParams({
    cod_usuario: cliente.cod_usuario,
    categoria: cliente.categoria,
    nome_usuario: cliente.nome_usuario,
  });
  return apiFetch<CotasGrafConsumoHistoricoResponse>(
    `/cotas-graf/solicitantes-cotas/historico?${params.toString()}`,
  );
}

export async function fetchCotasGrafList(
  filters: CotasGrafSearchFilters,
): Promise<CotasGrafListResponse> {
  const qs = buildCotasGrafQueryString(filters);
  return apiFetch<CotasGrafListResponse>(`/cotas-graf/list?${qs}`);
}

export async function lancarCotasGraf(
  ano: number,
  nrOs: number,
): Promise<{ nr_os: number; ano: number; cotas_graf_atualizado: boolean }> {
  return apiFetch(`/cotas-graf/${ano}/${nrOs}/lancar`, { method: "POST" });
}
