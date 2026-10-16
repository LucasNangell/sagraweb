import { apiFetch, apiUrl } from "@/lib/api";

export type GravacaoComponente = "todos" | "capa" | "miolo";

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
  componente?: GravacaoComponente;
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
  componente?: GravacaoComponente;
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

function withExternaId(path: string, gravacaoExternaId?: number | null): string {
  if (gravacaoExternaId == null) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}gravacao_externa_id=${gravacaoExternaId}`;
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
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(withExternaId(`/gravacao-externa/${ano}/${nrOs}`, gravacaoExternaId));
}

export async function removerOsGravacaoExterna(
  gravacaoExternaId: number,
): Promise<GravacaoExternaQueueRemovalResponse> {
  return apiFetch<GravacaoExternaQueueRemovalResponse>(
    `/gravacao-externa/fila/${gravacaoExternaId}/remover`,
    { method: "POST" },
  );
}

export async function removerOsAguardandoEntrega(
  gravacaoExternaId: number,
): Promise<GravacaoExternaQueueRemovalResponse> {
  return apiFetch<GravacaoExternaQueueRemovalResponse>(
    `/gravacao-externa/aguardando-entrega/${gravacaoExternaId}/remover`,
    { method: "POST" },
  );
}

export async function iniciarGravacaoExterna(
  ano: number,
  nrOs: number,
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(withExternaId(`/gravacao-externa/${ano}/${nrOs}/iniciar`, gravacaoExternaId), {
    method: "POST",
  });
}

export async function concluirGravacaoExterna(
  ano: number,
  nrOs: number,
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(withExternaId(`/gravacao-externa/${ano}/${nrOs}/concluir`, gravacaoExternaId), {
    method: "POST",
  });
}

export async function lancarEntregaChapas(
  ano: number,
  nrOs: number,
  payload: { recebidoPorPonto: string; recebidoPorNome: string },
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(
    withExternaId(`/gravacao-externa/${ano}/${nrOs}/entrega-chapas`, gravacaoExternaId),
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
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaDetail> {
  return apiFetch<GravacaoExternaDetail>(withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos`, gravacaoExternaId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arquivos }),
  });
}

export async function fetchGravacaoExternaMensagens(
  ano: number,
  nrOs: number,
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaMensagem[]> {
  return apiFetch<GravacaoExternaMensagem[]>(
    withExternaId(`/gravacao-externa/${ano}/${nrOs}/mensagens`, gravacaoExternaId),
  );
}

export async function postGravacaoExternaMensagem(
  ano: number,
  nrOs: number,
  mensagem: string,
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaMensagem> {
  return apiFetch<GravacaoExternaMensagem>(
    withExternaId(`/gravacao-externa/${ano}/${nrOs}/mensagens`, gravacaoExternaId),
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
  gravacaoExternaId?: number | null,
): string {
  return apiUrl(withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/${arquivoId}/download`, gravacaoExternaId));
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
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaZipStatus> {
  return apiFetch<GravacaoExternaZipStatus>(
    withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/zip`, gravacaoExternaId),
    { method: "POST" },
  );
}

export async function getGravacaoExternaZipStatus(
  ano: number,
  nrOs: number,
  gravacaoExternaId?: number | null,
): Promise<GravacaoExternaZipStatus> {
  return apiFetch<GravacaoExternaZipStatus>(
    withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/zip`, gravacaoExternaId),
  );
}

export function gravacaoExternaZipDownloadUrl(ano: number, nrOs: number, gravacaoExternaId?: number | null): string {
  return apiUrl(withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/zip/download`, gravacaoExternaId));
}

export function gravacaoExternaDownloadAllUrl(ano: number, nrOs: number, gravacaoExternaId?: number | null): string {
  return apiUrl(withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/download-all`, gravacaoExternaId));
}

export function gravacaoExternaPreviewUrl(
  ano: number,
  nrOs: number,
  arquivoId: number,
  gravacaoExternaId?: number | null,
): string {
  return apiUrl(withExternaId(`/gravacao-externa/${ano}/${nrOs}/arquivos/${arquivoId}/preview`, gravacaoExternaId));
}

export function gravacaoExternaCompositePreviewUrl(
  ano: number,
  nrOs: number,
  groupKey: string,
  gravacaoExternaId?: number | null,
): string {
  const params = new URLSearchParams({ group_key: groupKey });
  if (gravacaoExternaId != null) params.set("gravacao_externa_id", String(gravacaoExternaId));
  return apiUrl(`/gravacao-externa/${ano}/${nrOs}/preview-composite?${params.toString()}`);
}
