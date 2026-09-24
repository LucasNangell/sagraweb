import { apiFetch, apiUrl } from "@/lib/api";

export interface GravacaoExternaOsMembro {
  nr_os: number;
  ano: number;
}

export interface GravacaoExternaOsItem {
  nr_os: number;
  ano: number;
  solicitante?: string | null;
  produto?: string | null;
  titulo?: string | null;
  situacao?: string | null;
  setor?: string | null;
  last_update?: string | null;
  gravacao_externa_id?: number | null;
  gravacao_status: string;
  lancado_por_ponto?: string | null;
  lancado_por_nome?: string | null;
  fornecedor_ponto?: string | null;
  fornecedor_nome?: string | null;
  concluida_em?: string | null;
  concluida_por_ponto?: string | null;
  gravacao_criado_em?: string | null;
  chapas_por_maquina?: { maquina: string; quantidade: number }[] | null;
  total_chapas?: number | null;
  juntada_grupo_id?: string | null;
  membros?: GravacaoExternaOsMembro[];
}

export interface GravacaoExternaOsListResponse {
  items: GravacaoExternaOsItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface GravacaoExternaQueueRemovalResponse {
  removed: boolean;
  gravacao_externa_id: number;
  removed_ids: number[];
  juntada_grupo_id?: string | null;
}

export interface GravacaoExternaArquivo {
  id: number;
  relative: string;
  absolute_path?: string | null;
  nome: string;
  tamanho_bytes?: number | null;
  ordem: number;
  maquina?: string | null;
}

export interface GravacaoExternaMensagem {
  id: number;
  autor_ponto: string;
  autor_nome?: string | null;
  autor_papel: string;
  mensagem: string;
  criado_em?: string | null;
}

export interface GravacaoExternaDetail {
  id: number;
  os_ano: number;
  os_nro: number;
  cod_status: string;
  lancado_por_ponto: string;
  lancado_por_nome?: string | null;
  status: string;
  iniciado_por_ponto?: string | null;
  iniciado_em?: string | null;
  criado_em?: string | null;
  origem_pendente_id?: number | null;
  fornecedor_ponto?: string | null;
  concluida_em?: string | null;
  concluida_por_ponto?: string | null;
  entrega_lancada_em?: string | null;
  recebido_por_ponto?: string | null;
  recebido_por_nome?: string | null;
  pagamento_nf_em?: string | null;
  observacao?: string | null;
  arquivos: GravacaoExternaArquivo[];
  mensagens: GravacaoExternaMensagem[];
}

export interface GravacaoExternaListFilters {
  ano?: number | null;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildListQuery(filters: GravacaoExternaListFilters): string {
  const params = new URLSearchParams();
  if (filters.ano != null && !Number.isNaN(filters.ano)) {
    params.set("ano", String(filters.ano));
  }
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  params.set("limit", String(filters.limit ?? 200));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

export async function fetchGravacaoExternaOsList(
  filters: GravacaoExternaListFilters,
): Promise<GravacaoExternaOsListResponse> {
  const qs = buildListQuery(filters);
  return apiFetch<GravacaoExternaOsListResponse>(`/gravacao-externa/os?${qs}`);
}

export async function fetchGravacaoExternaAguardandoEntrega(
  filters: GravacaoExternaListFilters = {},
): Promise<GravacaoExternaOsListResponse> {
  const qs = buildListQuery(filters);
  return apiFetch<GravacaoExternaOsListResponse>(
    `/gravacao-externa/aguardando-entrega?${qs}`,
  );
}

export async function fetchGravacaoExternaDetail(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(`/gravacao-externa/${ano}/${nrOs}`);
}

export async function removerOsGravacaoExterna(
  gravacaoExternaId: number,
): Promise<GravacaoExternaQueueRemovalResponse> {
  return apiFetch<GravacaoExternaQueueRemovalResponse>(
    `/gravacao-externa/fila/${gravacaoExternaId}/remover`,
    { method: "POST" },
  );
}

export async function iniciarGravacaoExterna(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(`/gravacao-externa/${ano}/${nrOs}/iniciar`, {
    method: "POST",
  });
}

export async function concluirGravacaoExterna(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(`/gravacao-externa/${ano}/${nrOs}/concluir`, {
    method: "POST",
  });
}

export async function lancarEntregaChapas(
  ano: number,
  nrOs: number,
  payload: { recebidoPorPonto: string; recebidoPorNome: string },
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(
    `/gravacao-externa/${ano}/${nrOs}/entrega-chapas`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recebido_por_ponto: payload.recebidoPorPonto,
        recebido_por_nome: payload.recebidoPorNome,
      }),
    },
  );
}

export async function updateGravacaoExternaArquivos(
  ano: number,
  nrOs: number,
  arquivos: { absolute_path: string; nome: string; maquina?: string | null }[],
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(`/gravacao-externa/${ano}/${nrOs}/arquivos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arquivos }),
  });
}

export async function fetchGravacaoExternaMensagens(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaMensagem[]> {
  return apiFetch<GravacaoExternaMensagem[]>(
    `/gravacao-externa/${ano}/${nrOs}/mensagens`,
  );
}

export async function postGravacaoExternaMensagem(
  ano: number,
  nrOs: number,
  mensagem: string,
): Promise<GravacaoExternaMensagem> {
  return apiFetch<GravacaoExternaMensagem>(
    `/gravacao-externa/${ano}/${nrOs}/mensagens`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagem }),
    },
  );
}

export function gravacaoExternaDownloadUrl(
  ano: number,
  nrOs: number,
  arquivoId: number,
): string {
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/arquivos/${arquivoId}/download`);
}

export type GravacaoExternaZipStatus = {
  status: "pendente" | "gerando" | "pronto" | "erro" | string;
  assinatura: string;
  nome_arquivo?: string | null;
  tamanho_bytes?: number | null;
  total_arquivos: number;
  arquivos_prontos: number;
  bytes_prontos: number;
  erro?: string | null;
  etag?: string | null;
};

export async function startGravacaoExternaZip(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaZipStatus> {
  return apiFetch<GravacaoExternaZipStatus>(
    `/gravacao-externa/${ano}/${nrOs}/arquivos/zip`,
    { method: "POST" },
  );
}

export async function getGravacaoExternaZipStatus(
  ano: number,
  nrOs: number,
): Promise<GravacaoExternaZipStatus> {
  return apiFetch<GravacaoExternaZipStatus>(
    `/gravacao-externa/${ano}/${nrOs}/arquivos/zip`,
  );
}

export function gravacaoExternaZipDownloadUrl(ano: number, nrOs: number): string {
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/arquivos/zip/download`);
}

export function gravacaoExternaDownloadAllUrl(ano: number, nrOs: number): string {
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/arquivos/download-all`);
}

export function gravacaoExternaPreviewUrl(
  ano: number,
  nrOs: number,
  arquivoId: number,
): string {
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/arquivos/${arquivoId}/preview`);
}

export function gravacaoExternaCompositePreviewUrl(
  ano: number,
  nrOs: number,
  groupKey: string,
): string {
  const params = new URLSearchParams({ group_key: groupKey });
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/preview-composite?${params.toString()}`);
}
