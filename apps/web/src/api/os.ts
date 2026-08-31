import { apiFetch, apiUrl } from "@/api/client";

import type {
  HistoryPayload,
  OsAuditLogRow,
  OsComponenteRow,
  OsDetails,
  OsHistoryRow,
  OsSearchFilters,
  OsSearchResponse,
  OsVinculo,
  OsVinculoGrupoConfig,
  OsVinculoReplicacaoCheck,
  SubOsHistoryPayload,
  SubOsHistoryRow,
  SubOsRow,
} from "@/features/os/types";
import { digitsOnly } from "@/features/os/processoMask";

function appendList(
  params: URLSearchParams,
  key: string,
  values: string[],
): void {
  for (const value of values) {
    if (value.trim()) {
      params.append(key, value.trim());
    }
  }
}

export function buildOsSearchQueryString(filters: OsSearchFilters): string {
  const params = new URLSearchParams();

  if (filters.nrOs != null && !Number.isNaN(filters.nrOs)) {
    params.append("nr_os", String(filters.nrOs));
  }
  const anos = filters.anos ?? [];
  if (anos.length > 0) {
    for (const y of anos) {
      if (y != null && !Number.isNaN(y)) {
        params.append("anos", String(y));
      }
    }
  } else if (filters.ano != null && !Number.isNaN(filters.ano)) {
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
  if (filters.processo?.trim()) {
    const processoDigits = digitsOnly(filters.processo);
    if (processoDigits) {
      params.append("processo", processoDigits);
    }
  }
  if (filters.solicitantes.length > 0) {
    appendList(params, "solicitantes", filters.solicitantes);
  } else if (filters.solicitante?.trim()) {
    params.append("solicitante", filters.solicitante.trim());
  }

  appendList(params, "categorias", filters.categorias ?? []);
  appendList(params, "maquinas", filters.maquinas ?? []);
  appendList(params, "situacao", filters.situacao);
  appendList(params, "setor", filters.setor);
  appendList(params, "prioridade", filters.prioridade);

  params.append("include_finished", String(filters.includeFinished));
  params.append("include_os", String(filters.includeOs));
  params.append("include_sp", String(filters.includeSp));
  // Paginação simples (limit+1 + has_next). COUNT só fora do lookup exato por Nr OS.
  params.append("simple_pagination", "true");
  if (!filters.exactOsLookup) {
    params.append("include_total", "true");
  }
  params.append("page", String(filters.page));
  params.append("limit", String(filters.limit));

  if (filters.sortBy) {
    params.append("sort_by", filters.sortBy);
  }
  if (filters.sortDir) {
    params.append("sort_dir", filters.sortDir);
  }
  if (filters.exactOsLookup) {
    params.append("exact_os_lookup", "true");
  }

  return params.toString();
}

export async function searchOs(
  filters: OsSearchFilters,
  init?: RequestInit,
): Promise<OsSearchResponse> {
  const qs = buildOsSearchQueryString(filters);
  return apiFetch<OsSearchResponse>(`/os/search?${qs}`, init);
}

/** Query string para exportação — mesmos filtros da lista, sem paginação. */
export function buildOsExportQueryString(filters: OsSearchFilters): string {
  const params = new URLSearchParams(buildOsSearchQueryString(filters));
  params.delete("page");
  params.delete("limit");
  params.delete("simple_pagination");
  params.delete("include_total");
  return params.toString();
}

async function parseOsExportError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    /* resposta não-JSON */
  }
  return text.trim() || `Erro HTTP ${res.status}`;
}

/** Exporta todas as OSs filtradas (não apenas a página atual) em XLSX. */
export async function exportOsListXlsx(
  filters: OsSearchFilters,
  init?: RequestInit,
): Promise<Blob> {
  const qs = buildOsExportQueryString(filters);
  const res = await fetch(apiUrl(`/os/search/export/xlsx?${qs}`), {
    ...init,
    credentials: "include",
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(await parseOsExportError(res));
  }
  return res.blob();
}

export function downloadOsListXlsx(blob: Blob): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Lista_OS_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  anchor.remove();
}

export async function fetchOsPath(
  ano: number,
  id: number,
): Promise<{ path: string }> {
  return apiFetch<{ path: string }>(`/os/${ano}/${id}/path`);
}

export interface OsFolderBrowseEntry {
  name: string;
  type: "folder" | "file";
  relative: string;
  size?: number | null;
}

export interface OsFolderBrowseResponse {
  root_path: string;
  relative: string;
  entries: OsFolderBrowseEntry[];
  error?: string | null;
}

export async function fetchOsFolderBrowse(
  ano: number,
  id: number,
  relative = "",
): Promise<OsFolderBrowseResponse> {
  const params = new URLSearchParams();
  if (relative) {
    params.set("relative", relative);
  }
  const qs = params.toString();
  return apiFetch<OsFolderBrowseResponse>(
    `/os/${ano}/${id}/folder-browse${qs ? `?${qs}` : ""}`,
  );
}

export interface OsFolderPlanResponse {
  exists: boolean;
  folder_name: string;
  base_path: string;
  full_path: string;
  subfolders: string[];
  solicitante: string;
  produto: string;
}

export interface OsFolderCreateResponse {
  path: string;
  folder_name: string;
  created: boolean;
  subfolders: string[];
  message: string;
}

export async function fetchOsFolderPlan(
  ano: number,
  id: number,
): Promise<OsFolderPlanResponse> {
  return apiFetch<OsFolderPlanResponse>(`/os/${ano}/${id}/folder-plan`);
}

export async function createOsFolder(
  ano: number,
  id: number,
): Promise<OsFolderCreateResponse> {
  return apiFetch<OsFolderCreateResponse>(`/os/${ano}/${id}/folder-create`, {
    method: "POST",
  });
}

export interface OsFolderMoveFolderItem {
  from_name: string;
  to_name: string;
  dest_path?: string | null;
}

export interface OsFolderMoveAndamentoItem {
  situacao?: string | null;
  setor?: string | null;
  data?: string | null;
  ponto?: string | null;
  observacao?: string | null;
}

export interface OsFolderMovePreviewResponse {
  dest_solicitante: string;
  dest_produto: string;
  origem_solicitante: string;
  origem_produto: string;
  same_solicitante: boolean;
  same_produto: boolean;
  meta_mismatch: boolean;
  origem_folder_exists: boolean;
  origem_folder_path: string;
  dest_folder_exists: boolean;
  dest_folder_path: string;
  folders_to_move: OsFolderMoveFolderItem[];
  dest_conflicts: string[];
  can_execute: boolean;
  origem_situacao?: string | null;
  origem_concluida?: boolean;
  origem_andamentos?: OsFolderMoveAndamentoItem[];
}

export interface OsFolderMoveExecuteResponse {
  status: string;
  dest_folder_path: string;
  origem_folder_path: string;
  moved_folders: OsFolderMoveFolderItem[];
  transfer_suffix: string;
  dest_folder_created: boolean;
  meta_mismatch: boolean;
}

export interface OsFolderMoveExecutePayload {
  origem_ano: number;
  origem_id: number;
  confirm_meta_mismatch?: boolean;
  append_repeticao_observ?: boolean;
  confirm_origem_nao_concluida?: boolean;
}

export async function previewOsFolderMove(
  destAno: number,
  destId: number,
  origemAno: number,
  origemId: number,
): Promise<OsFolderMovePreviewResponse> {
  return apiFetch<OsFolderMovePreviewResponse>(
    `/os/${destAno}/${destId}/folder-move/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origem_ano: origemAno,
        origem_id: origemId,
      }),
    },
  );
}

export async function executeOsFolderMove(
  destAno: number,
  destId: number,
  payload: OsFolderMoveExecutePayload,
): Promise<OsFolderMoveExecuteResponse> {
  return apiFetch<OsFolderMoveExecuteResponse>(
    `/os/${destAno}/${destId}/folder-move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchOsDetails(
  ano: number,
  id: number,
): Promise<OsDetails> {
  return apiFetch<OsDetails>(`/os/${ano}/${id}/details`);
}

export async function fetchGerenciaCotaAtual(params: {
  categoria?: string;
  nome_usuario: string;
  cod_usuario?: string;
  nro_os?: number;
}): Promise<{ saldo: number | null }> {
  const qs = new URLSearchParams();
  if (params.categoria?.trim()) qs.set("categoria", params.categoria.trim());
  qs.set("nome_usuario", params.nome_usuario.trim());
  if (params.cod_usuario?.trim()) qs.set("cod_usuario", params.cod_usuario.trim());
  if (params.nro_os != null && !Number.isNaN(params.nro_os)) {
    qs.set("nro_os", String(params.nro_os));
  }
  return apiFetch<{ saldo: number | null }>(`/gerencia/cota-atual?${qs.toString()}`);
}

export interface GerenciaCoefA4ProdutoItem {
  produto: string;
  coeficiente: number;
  amostras: number;
}

export async function fetchGerenciaCoefA4Produtos(): Promise<{
  items: GerenciaCoefA4ProdutoItem[];
}> {
  return apiFetch<{ items: GerenciaCoefA4ProdutoItem[] }>(
    "/gerencia/coef-a4-produtos",
  );
}

export async function fetchOsHistory(
  ano: number,
  id: number,
): Promise<OsHistoryRow[]> {
  return apiFetch<OsHistoryRow[]>(`/os/${ano}/${id}/history`);
}

export async function fetchOsAuditLog(
  ano: number,
  id: number,
): Promise<OsAuditLogRow[]> {
  return apiFetch<OsAuditLogRow[]>(`/os/${ano}/${id}/audit-log`);
}

export async function addOsHistory(
  ano: number,
  id: number,
  payload: HistoryPayload,
): Promise<{ new_id: string }> {
  return apiFetch<{ new_id: string }>(`/os/${ano}/${id}/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateOsHistory(
  ano: number,
  id: number,
  payload: HistoryPayload & { cod_status: string },
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/os/${ano}/${id}/history`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteOsHistory(
  ano: number,
  id: number,
  codStatus: string,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(
    `/os/${ano}/${id}/history/${encodeURIComponent(codStatus)}/delete`,
    { method: "POST" },
  );
}

export async function replicateOsHistory(
  ano: number,
  id: number,
  payload: HistoryPayload,
): Promise<{ status: string; replicated_to: number }> {
  return apiFetch(`/os/${ano}/${id}/history/replicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function createVinculoExcecao(
  ano: number,
  id: number,
  payload: {
    observacao: string;
    usuario_ponto?: string;
    situacao?: string;
    setor?: string;
  },
): Promise<{ status: string }> {
  return apiFetch(`/os/${ano}/${id}/vinculo/excecao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchOsVinculoGrupoConfig(
  ano: number,
  id: number,
): Promise<OsVinculoGrupoConfig> {
  return apiFetch<OsVinculoGrupoConfig>(`/os/${ano}/${id}/vinculo/grupo-config`);
}

export async function checkOsVinculoReplicacao(
  ano: number,
  id: number,
  situacao: string,
  setor: string,
): Promise<OsVinculoReplicacaoCheck> {
  const qs = new URLSearchParams({ situacao, setor });
  return apiFetch<OsVinculoReplicacaoCheck>(
    `/os/${ano}/${id}/vinculo/replicacao-check?${qs}`,
  );
}

export async function fetchOsVinculos(
  ano: number,
  id: number,
): Promise<OsVinculo[]> {
  return apiFetch<OsVinculo[]>(`/os/${ano}/${id}/vinculos`);
}

export async function fetchOsComponentes(
  ano: number,
  id: number,
  options?: { includeInactive?: boolean },
): Promise<OsComponenteRow[]> {
  const qs = options?.includeInactive ? "?include_inactive=true" : "";
  return apiFetch<OsComponenteRow[]>(`/os/${ano}/${id}/componentes${qs}`);
}

export async function fetchSubOsList(
  ano: number,
  id: number,
): Promise<SubOsRow[]> {
  return apiFetch<SubOsRow[]>(`/os/${ano}/${id}/sub-os`);
}

export async function fetchSubOsSummary(
  ano: number,
  id: number,
): Promise<{ count: number; has_sub_os: boolean }> {
  return apiFetch(`/os/${ano}/${id}/sub-os/summary`);
}

export async function createOrGetSubOs(
  ano: number,
  id: number,
  componenteId: number,
): Promise<{ id: number; display_name: string; created: boolean; congelada: boolean }> {
  return apiFetch(`/os/${ano}/${id}/sub-os`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ componente_id: componenteId }),
  });
}

export async function fetchSubOsHistory(
  ano: number,
  id: number,
  subOsId: number,
): Promise<SubOsHistoryRow[]> {
  return apiFetch<SubOsHistoryRow[]>(
    `/os/${ano}/${id}/sub-os/${subOsId}/history`,
  );
}

export async function addSubOsHistory(
  ano: number,
  id: number,
  subOsId: number,
  payload: SubOsHistoryPayload,
): Promise<{
  sub_history_id: number;
  mirror_cod_status: string;
  componente_nome: string;
  display_name: string;
}> {
  return apiFetch(`/os/${ano}/${id}/sub-os/${subOsId}/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteSubOsHistory(
  ano: number,
  id: number,
  subOsId: number,
  historyId: number,
): Promise<{
  status: string;
  inherited: boolean;
  ultimo_status_id?: number | null;
  still_listable: boolean;
}> {
  return apiFetch(
    `/os/${ano}/${id}/sub-os/${subOsId}/history/${historyId}/delete`,
    { method: "POST" },
  );
}

export async function createOsVinculo(
  ano: number,
  id: number,
  numero: number,
  vano: number,
  options?: {
    situacao?: string;
    setor?: string;
    criado_por?: string;
  },
): Promise<{ status: string }> {
  return apiFetch(`/os/${ano}/${id}/vincular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      numero,
      ano: vano,
      situacao: options?.situacao,
      setor: options?.setor,
      criado_por: options?.criado_por,
    }),
  });
}

export async function deleteOsVinculo(
  ano: number,
  id: number,
  vNum: number,
  vAno: number,
): Promise<{ status: string }> {
  return apiFetch(`/os/${ano}/${id}/vinculo/${vNum}/${vAno}/delete`, {
    method: "POST",
  });
}

export interface SaveOsPayload {
  NroProtocolo?: number | null;
  AnoProtocolo?: number | null;
  CodigoRequisicao?: string | null;
  CategoriaLink?: string | null;
  NomeUsuario?: string | null;
  Titular?: string | null;
  OrgInteressado?: string | null;
  SiglaOrgao?: string | null;
  GabSalaUsuario?: string | null;
  Andar?: string | null;
  Localizacao?: string | null;
  RamalUsuario?: string | null;
  DataEntrada?: string | null;
  ProcessoSolicit?: string | null;
  CSnro?: string | null;
  TiragemSolicitada?: string | null;
  TiragemFinal?: string | null;
  DebitarCGRAF?: boolean;
  Titulo?: string | null;
  TipoPublicacaoLink?: string | null;
  FormatoLink?: string | null;
  MaquinaLink?: string | null;
  Tiragem?: string | null;
  Pags?: string | null;
  FrenteVerso?: boolean;
  ModelosArq?: string | null;
  EntregPrazoLink?: string | null;
  EntregData?: string | null;
  EntregPeriodo?: string | null;
  ResponsavelGrafLink?: string | null;
  EntregaFormaLink?: string | null;
  PapelLink?: string | null;
  PapelDescricao?: string | null;
  Cores?: string | null;
  CoresDescricao?: string | null;
  DescAcabamento?: string | null;
  Observ?: string | null;
  ContatoTrab?: string | null;
  MaterialFornecido?: boolean;
  Fotolito?: boolean;
  ModeloDobra?: boolean;
  ProvaImpressa?: boolean;
  InsumosFornecidos?: string | null;
  ElemGrafBrasao?: boolean;
  ElemGrafTimbre?: boolean;
  ElemGrafArteGab?: boolean;
  ElemGrafAssinatura?: boolean;
  Calculos?: Record<string, string | number>;
  TechSpec?: {
    version?: number;
    acabamentosGerais?: Array<{
      catalog_id?: number;
      label?: string;
      variacao_id?: number;
      variacao_label?: string;
      obs?: string;
    }>;
    componentes?: Array<{
      componente_id?: number;
      nome?: string;
      tipo?: string;
      lotes?: Array<{
        id?: string;
        paginas?: number;
        maquina_link?: string;
        papel_link?: string;
        cores_link?: string;
        papel_desc?: string;
        cores_desc?: string;
        frente_verso?: boolean;
        acabamentos?: Array<{
          catalog_id?: number;
          label?: string;
          variacao_id?: number;
          variacao_label?: string;
          obs?: string;
        }>;
      }>;
      acabamentos?: Array<{
        catalog_id?: number;
        label?: string;
        variacao_id?: number;
        variacao_label?: string;
        obs?: string;
      }>;
    }>;
  };
  PontoUsuario?: string | null;
}

export interface SaveOsResponse {
  status: string;
  id?: number;
  ano?: number;
  message?: string;
}

export async function saveOs(payload: SaveOsPayload): Promise<SaveOsResponse> {
  return apiFetch<SaveOsResponse>("/os/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchNextOsId(
  year: number,
  type: "normal" | "papelaria",
): Promise<{ next_id: number; year: number }> {
  const q = new URLSearchParams({
    year: String(year),
    type,
  });
  return apiFetch(`/os/next_id?${q}`);
}
