import { apiFetch, apiUrl } from "@/lib/api";

export interface GravacaoPendenteOsMembro {
  nr_os: number;
  ano: number;
}

export interface GravacaoPendenteOsItem {
  nr_os: number;
  ano: number;
  solicitante?: string | null;
  produto?: string | null;
  situacao?: string | null;
  setor?: string | null;
  last_update?: string | null;
  gravacao_pendente_id?: number | null;
  gravacao_pendente_status: string;
  lancado_por_ponto?: string | null;
  lancado_por_nome?: string | null;
  gravacao_criado_em?: string | null;
  juntada_grupo_id?: string | null;
  membros?: GravacaoPendenteOsMembro[];
}

export interface GravacaoPendenteArquivo {
  id: number;
  absolute_path: string;
  nome: string;
  tamanho_bytes?: number | null;
  ordem: number;
  maquina?: string | null;
}

export interface GravacaoPendenteChapa {
  id: number;
  maquina: string;
  quantidade: number;
}

export interface GravacaoPendenteDetail {
  id: number;
  os_ano: number;
  os_nro: number;
  cod_status: string;
  lancado_por_ponto: string;
  lancado_por_nome?: string | null;
  status: string;
  enviada_em?: string | null;
  enviada_por_ponto?: string | null;
  criado_em?: string | null;
  arquivos: GravacaoPendenteArquivo[];
  chapas: GravacaoPendenteChapa[];
}

export interface GravacaoPendenteHistoricoItem {
  gravacao_pendente_id?: number | null;
  gravacao_externa_id?: number | null;
  ano: number;
  nr_os: number;
  solicitante?: string | null;
  titulo?: string | null;
  lancado_por_ponto?: string | null;
  lancado_por_nome?: string | null;
  iniciado_por_ponto?: string | null;
  iniciado_em?: string | null;
  criado_em?: string | null;
  enviada_em?: string | null;
  fornecedor_ponto?: string | null;
  fornecedor_nome?: string | null;
  concluida_em?: string | null;
  entrega_lancada_em?: string | null;
  recebido_por_ponto?: string | null;
  recebido_por_nome?: string | null;
  pagamento_nf_em?: string | null;
  total_chapas: number;
  chapas_por_maquina: { maquina: string; quantidade: number }[];
}

export interface GravacaoPendenteHistoricoResponse {
  items: GravacaoPendenteHistoricoItem[];
  total: number;
  total_chapas_geral: number;
  cota_inicial_chapas: number;
  chapas_restantes: number;
  maquinas?: GravacaoPendenteMaquinaCotaItem[];
}

export interface GravacaoPendenteCotaSummary {
  cota_inicial_chapas: number;
  total_chapas_geral: number;
  chapas_restantes: number;
  maquinas?: GravacaoPendenteMaquinaCotaItem[];
}

export interface GravacaoPendenteFornecedorItem {
  ponto: string;
  nome?: string | null;
}

export interface GravacaoPendenteMaquinaCotaItem {
  maquina: string;
  cota_chapas: number;
  chapas_restantes?: number;
}

export interface GravacaoPendenteMaquinaConfigItem {
  maquina: string;
  cota_chapas: number;
  preco_chapa: number;
}

export interface GravacaoPendenteMaquinaPrecoItem {
  maquina: string;
  preco_chapa: number;
}

export type GravacaoPendenteMaquinaNome = "Komori" | "SM74" | "PM52";

export interface GravacaoPendenteFornecedorCotasMap {
  Komori: number;
  SM74: number;
  PM52: number;
}

export interface GravacaoPendenteFornecedorPrecosMap {
  Komori: number;
  SM74: number;
  PM52: number;
}

export interface GravacaoPendenteFornecedorCotaItem {
  ponto: string;
  nome?: string | null;
  cotas: GravacaoPendenteFornecedorCotasMap;
  precos?: GravacaoPendenteFornecedorPrecosMap;
}

export interface GravacaoPendenteConfigDetalhes {
  cota_inicial_chapas: number;
  total_chapas_geral?: number;
  chapas_restantes?: number;
  maquinas: GravacaoPendenteMaquinaConfigItem[];
  fornecedor_cotas: GravacaoPendenteFornecedorCotaItem[];
}

export type GravacaoPendenteCotaAdjustMode = "set" | "inc" | "dec";

export interface GravacaoPendenteListFilters {
  ano?: number | null;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function fetchGravacaoPendenteOsList(filters: GravacaoPendenteListFilters) {
  const params = new URLSearchParams();
  if (filters.ano != null) params.set("ano", String(filters.ano));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  params.set("limit", String(filters.limit ?? 200));
  params.set("offset", String(filters.offset ?? 0));
  return apiFetch<{ items: GravacaoPendenteOsItem[]; total: number }>(
    `/gravacao-pendente/os?${params}`,
  );
}

export async function fetchGravacaoPendenteDetail(ano: number, nrOs: number) {
  return apiFetch<GravacaoPendenteDetail>(`/gravacao-pendente/${ano}/${nrOs}`);
}

export async function fetchGravacaoPendenteHistorico(limit = 100) {
  return apiFetch<GravacaoPendenteHistoricoResponse>(
    `/gravacao-pendente/historico?limit=${limit}`,
  );
}

export async function fetchGravacaoPendenteFornecedores() {
  return apiFetch<{ items: GravacaoPendenteFornecedorItem[] }>(
    "/gravacao-pendente/fornecedores",
  );
}

export async function adjustGravacaoPendenteCotaInicial(delta: 1 | -1) {
  return adjustGravacaoPendenteCotaDetalhes({
    mode: delta > 0 ? "inc" : "dec",
    valor: 1,
    observacao: "Ajuste rápido ±1",
  });
}

export async function adjustGravacaoPendenteCotaDetalhes(body: {
  mode: GravacaoPendenteCotaAdjustMode;
  valor: number;
  observacao: string;
}) {
  return apiFetch<GravacaoPendenteCotaSummary>(
    "/gravacao-pendente/historico/cota-inicial/adjust",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function fetchGravacaoPendenteConfigDetalhes() {
  return apiFetch<GravacaoPendenteConfigDetalhes>("/gravacao-pendente/config/detalhes");
}

export async function putGravacaoPendenteMaquinasConfig(
  maquinas: GravacaoPendenteMaquinaPrecoItem[],
) {
  return apiFetch<GravacaoPendenteConfigDetalhes>(
    "/gravacao-pendente/config/maquinas",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: maquinas }),
    },
  );
}

export async function putGravacaoPendenteFornecedorCotas(
  items: {
    ponto: string;
    maquina: string;
    cota_chapas: number;
    preco_chapa?: number;
  }[],
) {
  return apiFetch<GravacaoPendenteConfigDetalhes>(
    "/gravacao-pendente/config/fornecedor-cotas",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    },
  );
}

export async function patchGravacaoPendentePagamentoNf(
  gravacaoExternaId: number,
  pagamento_nf_em: string | null,
) {
  return apiFetch<{ gravacao_externa_id: number; pagamento_nf_em?: string | null }>(
    `/gravacao-pendente/controle/${gravacaoExternaId}/pagamento-nf`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagamento_nf_em }),
    },
  );
}

export async function deleteGravacaoPendenteControle(gravacaoPendenteId: number) {
  return apiFetch<{ deleted: boolean; gravacao_pendente_id: number }>(
    `/gravacao-pendente/controle/${gravacaoPendenteId}/delete`,
    { method: "POST" },
  );
}

export async function enviarGravacaoPendenteParaExterna(
  ano: number,
  nrOs: number,
  opts?: { fornecedorPonto?: string | null },
) {
  return apiFetch(`/gravacao-pendente/${ano}/${nrOs}/enviar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      setor: "SEFOC",
      ...(opts?.fornecedorPonto
        ? { fornecedor_ponto: opts.fornecedorPonto }
        : {}),
    }),
  });
}

export async function updateGravacaoPendenteArquivos(
  ano: number,
  nrOs: number,
  arquivos: { absolute_path: string; nome: string; maquina?: string | null }[],
  chapas?: { maquina: string; quantidade: number }[],
) {
  return apiFetch<GravacaoPendenteDetail>(`/gravacao-pendente/${ano}/${nrOs}/arquivos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      arquivos,
      ...(chapas != null ? { chapas } : {}),
    }),
  });
}

export interface GravacaoPendenteChapasEstimateResponse {
  total_chapas: number;
  fonte: "tif" | "pdf" | "none" | (string & {});
  /** Soma de páginas dos PDFs (= conjuntos esperados). Null se fonte ≠ pdf. */
  pdf_page_count?: number | null;
  /** Soma de tintas por página (= chapas/TIFs esperados). Null se indisponível. */
  expected_plate_count?: number | null;
  ink_analysis_status?: "ok" | "partial" | "unavailable" | (string & {}) | null;
}

export async function fetchGravacaoPendenteChapasEstimate(
  arquivos: { absolute_path: string; nome: string }[],
): Promise<GravacaoPendenteChapasEstimateResponse> {
  return apiFetch<GravacaoPendenteChapasEstimateResponse>(
    "/gravacao-pendente/chapas/estimate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arquivos }),
    },
  );
}

export function gravacaoPendentePreviewUrl(ano: number, nrOs: number, arquivoId: number): string {
  return apiUrl(`/gravacao-pendente/${ano}/${nrOs}/arquivos/${arquivoId}/preview`);
}

export function gravacaoPendenteCompositePreviewUrl(
  ano: number,
  nrOs: number,
  groupKey: string,
): string {
  const params = new URLSearchParams({ group_key: groupKey });
  return apiUrl(`/gravacao-pendente/${ano}/${nrOs}/preview-composite?${params.toString()}`);
}

export function gravacaoPendenteDownloadUrl(ano: number, nrOs: number, arquivoId: number): string {
  return apiUrl(`/gravacao-pendente/${ano}/${nrOs}/arquivos/${arquivoId}/download`);
}
