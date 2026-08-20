import { apiFetch, apiUrl } from "@/lib/api";
import type {
  CropSidesMm,
  ProvaWebCropJson,
  ProvaWebCropMetaResponse,
  ProvaWebManifestBase,
  ProvaWebModo,
} from "@/api/provaWeb";

export type AnaliseLabRenderStatus =
  | "pending"
  | "running"
  | "ready"
  | "error"
  | "cancelled"
  | string;

export type AnaliseLabMarkTipo =
  | "offset_corte"
  | "faixa"
  | "sangria"
  | "retangulo"
  | "ponto"
  | "medida"
  | "grade"
  | "seta"
  | "circulo"
  | "texto"
  | "livre";

export type AnaliseLabMarkCor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "black"
  | "white";

export type AnaliseLabEdge = "top" | "right" | "bottom" | "left" | "all";

export interface AnaliseLabRenderProgress {
  done?: number;
  total?: number;
}

export interface AnaliseLabSession {
  id: number;
  nroProtocolo: number;
  anoProtocolo: number;
  versaoLabel: string;
  modo: "unico" | "capa_miolo" | string;
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  fontes?: AnaliseLabFonte[] | null;
  cropJson?: ProvaWebCropJson | Record<string, unknown> | null;
  pastaRender: string;
  renderStatus: AnaliseLabRenderStatus;
  renderError?: string | null;
  renderProgress?: AnaliseLabRenderProgress | null;
  renderStartedAt?: string | null;
  renderFinishedAt?: string | null;
  cropVersao?: number;
  folhearModo?: "flipbook" | "folhas";
}

export interface AnaliseLabMark {
  id: number;
  sessaoId: number;
  pagina: number;
  /** Spec canônica: "1-15,20,23". Null/omitido = usa pagina (0=todas). */
  paginas?: string | null;
  tipo: AnaliseLabMarkTipo | string;
  geometria: Record<string, number | string | number[][]>;
  rotulo?: string | null;
  cor: AnaliseLabMarkCor | string;
  espelhar?: boolean;
  paginaOrigem?: number;
  cropVersao?: number;
  itemId?: number | null;
}

export type AnaliseLabItemEscopo = "pagina" | "paginas" | "arquivo";
export type AnaliseLabComponente = "Capa" | "Miolo" | "Arq. Único";

export type AnaliseLabCropScope =
  | "page"
  | "file"
  | "component"
  | "all"
  | "miolo_central";

export interface AnaliseLabFonte {
  path: string;
  componente: AnaliseLabComponente;
  ordem: number;
}

export type AnaliseLabProvidenciaTipo = "livre" | "autorizar_impressao" | string;
export type AnaliseLabProvidenciaOrigem =
  | "biblioteca"
  | "sistema"
  | "manual"
  | string;

export interface AnaliseLabItemProvidencia {
  id: number;
  labItemId: number;
  texto: string;
  tipo: AnaliseLabProvidenciaTipo;
  ordem: number;
  selecionada: boolean;
  origem: AnaliseLabProvidenciaOrigem;
}

export interface AnaliseLabItem {
  id: number;
  sessaoId: number;
  idProblemaPadrao?: number | null;
  titulo: string;
  htmlSnapshot: string;
  obs?: string | null;
  componente: AnaliseLabComponente | string;
  escopo: AnaliseLabItemEscopo | string;
  pagina: number;
  paginas?: string | null;
  versaoLabel: string;
  ordem: number;
  resolucaoObrigatoria?: boolean;
  corrigidoSefoc?: boolean;
  obsCorrecaoSefoc?: string | null;
  itemAnaliseId?: number | null;
  providencias?: AnaliseLabItemProvidencia[];
}

export interface AnaliseLabInfo {
  ano: number;
  os: number;
  session: AnaliseLabSession | null;
  marks: AnaliseLabMark[];
  itens?: AnaliseLabItem[];
  osFolderFound: boolean;
  titulo: string;
  produto: string;
  solicitante: string;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
}

export interface AnaliseLabFileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
  modifiedAt: string | null;
}

export interface AnaliseLabManifest extends ProvaWebManifestBase {
  session: AnaliseLabSession;
  labWarnings?: string[];
  partial?: boolean;
  renderStatus?: string | null;
  renderProgress?: AnaliseLabRenderProgress | null;
  expectedPageCount?: number | null;
}

export interface SaveAnaliseLabPayload {
  versao_label: string;
  modo: "unico" | "capa_miolo";
  arquivo_unico?: string | null;
  arquivo_capa?: string | null;
  arquivo_miolo?: string | null;
  fontes?: AnaliseLabFonte[];
  crop_json?: ProvaWebCropJson | null;
  folhear_modo?: "flipbook" | "folhas";
}

export interface PatchAnaliseLabCropPayload {
  crop?: CropSidesMm | null;
  scope?: AnaliseLabCropScope | null;
  path?: string | null;
  source_page?: number | null;
  source_sequence?: number | null;
  componente?: AnaliseLabComponente | string | null;
  capa?: ProvaWebCropJson["capa"] | null;
}

export interface CreateAnaliseLabMarkPayload {
  pagina: number;
  tipo: AnaliseLabMarkTipo;
  geometria: Record<string, number | string | number[][]>;
  rotulo?: string | null;
  cor?: AnaliseLabMarkCor;
  espelhar?: boolean;
  pagina_origem?: number;
  paginas?: string | null;
  item_id?: number | null;
}

export interface UpdateAnaliseLabMarkPayload {
  pagina?: number;
  geometria?: Record<string, number | string | number[][]>;
  rotulo?: string | null;
  cor?: AnaliseLabMarkCor;
  espelhar?: boolean;
  pagina_origem?: number;
  paginas?: string | null;
  item_id?: number | null;
}

export async function fetchAnaliseLabInfo(
  ano: number,
  osId: number,
): Promise<AnaliseLabInfo> {
  return apiFetch<AnaliseLabInfo>(`/os/${ano}/${osId}/analise-lab`);
}

export async function fetchAnaliseLabFiles(
  ano: number,
  osId: number,
  versao: string,
): Promise<{ files: AnaliseLabFileEntry[]; truncated: boolean }> {
  const q = new URLSearchParams({ versao });
  return apiFetch(`/os/${ano}/${osId}/analise-lab/files?${q.toString()}`);
}

export async function saveAnaliseLab(
  ano: number,
  osId: number,
  payload: SaveAnaliseLabPayload,
): Promise<{
  ok: boolean;
  session: AnaliseLabSession;
  renderStatus?: AnaliseLabRenderStatus;
}> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function patchAnaliseLabCrop(
  ano: number,
  osId: number,
  payload: PatchAnaliseLabCropPayload,
): Promise<{
  ok: boolean;
  session: AnaliseLabSession;
  renderStatus?: AnaliseLabRenderStatus;
  partial?: boolean;
  dirtyPages?: number[];
}> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/crop`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function reprocessAnaliseLab(
  ano: number,
  osId: number,
): Promise<{ ok: boolean; session: AnaliseLabSession | null }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/reprocessar`, {
    method: "POST",
  });
}

export async function fetchAnaliseLabManifest(
  ano: number,
  osId: number,
): Promise<AnaliseLabManifest> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/manifest`);
}

export function analiseLabPageUrl(
  ano: number,
  osId: number,
  page: number,
  cacheKey?: string,
): string {
  const q = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return apiUrl(`/os/${ano}/${osId}/analise-lab/pages/${page}.png${q}`);
}

export function analiseLabSourcePdfUrl(
  ano: number,
  osId: number,
  relativePath: string,
): string {
  const q = new URLSearchParams({ path: relativePath });
  return apiUrl(`/os/${ano}/${osId}/analise-lab/pdf?${q.toString()}`);
}

export async function fetchAnaliseLabCropMeta(
  ano: number,
  osId: number,
  relativePath: string,
  opts?: { detectMarks?: boolean },
): Promise<ProvaWebCropMetaResponse> {
  const q = new URLSearchParams({ path: relativePath });
  if (opts?.detectMarks) {
    q.set("detect_marks", "true");
  }
  return apiFetch(
    `/os/${ano}/${osId}/analise-lab/crop-meta?${q.toString()}`,
  );
}

export async function createAnaliseLabMark(
  ano: number,
  osId: number,
  payload: CreateAnaliseLabMarkPayload,
): Promise<{ ok: boolean; mark: AnaliseLabMark }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/marcas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateAnaliseLabMark(
  ano: number,
  osId: number,
  markId: number,
  payload: UpdateAnaliseLabMarkPayload,
): Promise<{ ok: boolean; mark: AnaliseLabMark }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/marcas/${markId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteAnaliseLabMark(
  ano: number,
  osId: number,
  markId: number,
): Promise<{ ok: boolean }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/marcas/${markId}`, {
    method: "DELETE",
  });
}

export async function listAnaliseLabMarks(
  ano: number,
  osId: number,
): Promise<{ marks: AnaliseLabMark[] }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/marcas`);
}

export interface CreateAnaliseLabItemPayload {
  id_problema?: number | null;
  titulo?: string;
  html_snapshot?: string;
  escopo: AnaliseLabItemEscopo;
  pagina?: number;
  paginas?: string | null;
  componente?: string | null;
  versao_label?: string | null;
  obs?: string | null;
  confirm_split?: boolean;
}

export interface UpdateAnaliseLabItemPayload {
  titulo?: string;
  html_snapshot?: string;
  obs?: string | null;
  componente?: string;
  escopo?: AnaliseLabItemEscopo;
  pagina?: number;
  paginas?: string | null;
  resolucao_obrigatoria?: boolean;
  ordem?: number;
  corrigido_sefoc?: boolean;
  obs_correcao_sefoc?: string | null;
}

export async function createAnaliseLabItem(
  ano: number,
  osId: number,
  payload: CreateAnaliseLabItemPayload,
): Promise<{
  ok: boolean;
  items: AnaliseLabItem[];
  needsConfirm?: boolean;
  splitPreview?: Record<string, string> | null;
}> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/itens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateAnaliseLabItem(
  ano: number,
  osId: number,
  itemId: number,
  payload: UpdateAnaliseLabItemPayload,
): Promise<{ ok: boolean; item: AnaliseLabItem }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/itens/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveAnaliseLabItemProvidencias(
  ano: number,
  osId: number,
  itemId: number,
  providencias: Array<{
    id?: number;
    texto: string;
    tipo?: string;
    ordem?: number;
    selecionada?: boolean;
    origem?: string;
  }>,
): Promise<{
  ok: boolean;
  providencias: AnaliseLabItemProvidencia[];
  item: AnaliseLabItem;
}> {
  return apiFetch(
    `/os/${ano}/${osId}/analise-lab/itens/${itemId}/providencias`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providencias }),
    },
  );
}

export async function deleteAnaliseLabItem(
  ano: number,
  osId: number,
  itemId: number,
): Promise<{ ok: boolean }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/itens/${itemId}`, {
    method: "DELETE",
  });
}

export async function replicateAnaliseLabItems(
  ano: number,
  osId: number,
  payload: { item_ids: number[]; copiar_marcas?: boolean },
): Promise<{ ok: boolean; items: AnaliseLabItem[] }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/itens/replicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function reorderAnaliseLabItems(
  ano: number,
  osId: number,
  ordem: number[],
): Promise<{ ok: boolean; itens: AnaliseLabItem[] }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/itens/reordenar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordem }),
  });
}

export async function fetchAnaliseLabRelatorio(
  ano: number,
  osId: number,
): Promise<{ html: string }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/relatorio`);
}

export async function concluirAnaliseLab(
  ano: number,
  osId: number,
  payload?: { versao?: string; usuario?: string },
): Promise<{ ok: boolean; url: string; idAnalise: number; versao: string }> {
  return apiFetch(`/os/${ano}/${osId}/analise-lab/concluir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export type AnaliseLabModo = Extract<ProvaWebModo, "unico" | "capa_miolo">;
