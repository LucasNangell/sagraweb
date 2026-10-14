import { apiFetch, apiUrl } from "@/lib/api";

export type GravacaoComponente = "todos" | "capa" | "miolo";

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
  componente?: GravacaoComponente;
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

/** Parte da sessão desmembrada por máquina e já enviada ao Birô. */
export interface GravacaoPendenteEnvioParcial {
  gravacao_pendente_id: number;
  gravacao_externa_id?: number | null;
  externa_status?: string | null;
  componente?: GravacaoComponente;
  fornecedor_ponto?: string | null;
  fornecedor_nome?: string | null;
  enviada_em?: string | null;
  maquinas: string[];
  arquivos: GravacaoPendenteArquivo[];
  chapas: GravacaoPendenteChapa[];
}

export interface GravacaoPendenteDetail {
  id: number;
  os_ano: number;
  os_nro: number;
  cod_status: string;
  componente?: GravacaoComponente;
  lancado_por_ponto: string;
  lancado_por_nome?: string | null;
  status: string;
  enviada_em?: string | null;
  enviada_por_ponto?: string | null;
  criado_em?: string | null;
  observacao?: string | null;
  desmembrada_de_id?: number | null;
  arquivos: GravacaoPendenteArquivo[];
  chapas: GravacaoPendenteChapa[];
  envios?: GravacaoPendenteEnvioParcial[];
}

export interface GravacaoPendenteAdicionarBody {
  arquivos: { absolute_path: string; nome: string; maquina?: string | null }[];
  chapas: { maquina: string; quantidade: number }[];
  observacao?: string;
  juntadas?: GravacaoPendenteOsMembro[];
  componente?: GravacaoComponente;
}

export interface GravacaoPendenteQueueRemovalResponse {
  removed: boolean;
  gravacao_pendente_id: number;
  removed_ids: number[];
  juntada_grupo_id?: string | null;
}

export interface GravacaoPendenteHistoricoItem {
  gravacao_pendente_id?: number | null;
  gravacao_externa_id?: number | null;
  ano: number;
  nr_os: number;
  juntada_grupo_id?: string | null;
  membros?: GravacaoPendenteOsMembro[];
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

export interface GravacaoPendenteControleUpdateBody {
  chapas: { maquina: string; quantidade: number }[];
  criado_em?: string | null;
  enviada_em?: string | null;
  fornecedor_ponto?: string | null;
  concluida_em?: string | null;
  entrega_lancada_em?: string | null;
  recebido_por_ponto?: string | null;
  recebido_por_nome?: string | null;
  pagamento_nf_em?: string | null;
}

export interface GravacaoPendenteControleUpdateResponse {
  gravacao_pendente_id: number;
  updated_pendente_ids: number[];
  updated_externa_ids: number[];
  juntada_grupo_id?: string | null;
  chapas: { maquina: string; quantidade: number }[];
  total_chapas: number;
  criado_em?: string | null;
  enviada_em?: string | null;
  fornecedor_ponto?: string | null;
  concluida_em?: string | null;
  entrega_lancada_em?: string | null;
  recebido_por_ponto?: string | null;
  recebido_por_nome?: string | null;
  pagamento_nf_em?: string | null;
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

function withPendenteId(path: string, gravacaoPendenteId?: number | null): string {
  if (gravacaoPendenteId == null) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}gravacao_pendente_id=${gravacaoPendenteId}`;
}

export async function fetchGravacaoPendenteDetail(ano: number, nrOs: number, gravacaoPendenteId?: number | null) {
  return apiFetch<GravacaoPendenteDetail>(withPendenteId(`/gravacao-pendente/${ano}/${nrOs}`, gravacaoPendenteId));
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

export async function patchGravacaoPendenteControle(
  gravacaoPendenteId: number,
  body: GravacaoPendenteControleUpdateBody,
) {
  return apiFetch<GravacaoPendenteControleUpdateResponse>(
    `/gravacao-pendente/controle/${gravacaoPendenteId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  opts?: {
    fornecedorPonto?: string | null;
    gravacaoPendenteId?: number | null;
    /** Todas as sessões ativas do card da OS (capa/miolo). */
    gravacaoPendenteIds?: number[];
    /** Envia só os arquivos destas máquinas; vazio envia tudo. */
    maquinas?: string[];
  },
) {
  return apiFetch(`/gravacao-pendente/${ano}/${nrOs}/enviar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      setor: "Grav. Externa",
      ...(opts?.gravacaoPendenteId != null
        ? { gravacao_pendente_id: opts.gravacaoPendenteId }
        : {}),
      ...(opts?.fornecedorPonto
        ? { fornecedor_ponto: opts.fornecedorPonto }
        : {}),
      ...(opts?.gravacaoPendenteIds?.length
        ? { gravacao_pendente_ids: opts.gravacaoPendenteIds }
        : {}),
      ...(opts?.maquinas?.length ? { maquinas: opts.maquinas } : {}),
    }),
  });
}

export async function adicionarOsGravacaoPendente(
  ano: number,
  nrOs: number,
  body: GravacaoPendenteAdicionarBody,
) {
  return apiFetch<GravacaoPendenteDetail>(
    `/gravacao-pendente/${ano}/${nrOs}/adicionar`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function removerOsGravacaoPendente(
  gravacaoPendenteId: number,
): Promise<GravacaoPendenteQueueRemovalResponse> {
  return apiFetch<GravacaoPendenteQueueRemovalResponse>(
    `/gravacao-pendente/fila/${gravacaoPendenteId}/remover`,
    { method: "POST" },
  );
}

export async function patchGravacaoPendenteObservacao(
  ano: number,
  nrOs: number,
  observacao: string,
  gravacaoPendenteId?: number | null,
) {
  return apiFetch<GravacaoPendenteDetail>(
    withPendenteId(`/gravacao-pendente/${ano}/${nrOs}/observacao`, gravacaoPendenteId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observacao }),
    },
  );
}

export async function updateGravacaoPendenteArquivos(
  ano: number,
  nrOs: number,
  arquivos: { absolute_path: string; nome: string; maquina?: string | null }[],
  chapas?: { maquina: string; quantidade: number }[],
  gravacaoPendenteId?: number | null,
) {
  return apiFetch<GravacaoPendenteDetail>(withPendenteId(`/gravacao-pendente/${ano}/${nrOs}/arquivos`, gravacaoPendenteId), {
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

export function gravacaoPendentePreviewUrl(ano: number, nrOs: number, arquivoId: number, gravacaoPendenteId?: number | null): string {
  return apiUrl(withPendenteId(`/gravacao-pendente/${ano}/${nrOs}/arquivos/${arquivoId}/preview`, gravacaoPendenteId));
}

export function gravacaoPendenteCompositePreviewUrl(
  ano: number,
  nrOs: number,
  groupKey: string,
  gravacaoPendenteId?: number | null,
): string {
  const params = new URLSearchParams({ group_key: groupKey });
  if (gravacaoPendenteId != null) params.set("gravacao_pendente_id", String(gravacaoPendenteId));
  return apiUrl(`/gravacao-pendente/${ano}/${nrOs}/preview-composite?${params.toString()}`);
}

export function gravacaoPendenteDownloadUrl(ano: number, nrOs: number, arquivoId: number, gravacaoPendenteId?: number | null): string {
  return apiUrl(withPendenteId(`/gravacao-pendente/${ano}/${nrOs}/arquivos/${arquivoId}/download`, gravacaoPendenteId));
}
