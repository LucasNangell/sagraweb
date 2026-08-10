import { apiFetch, apiUrl } from "@/lib/api";
import type {
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
  | "retangulo"
  | "ponto"
  | "medida"
  | "grade";

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
  cropJson?: ProvaWebCropJson | Record<string, unknown> | null;
  pastaRender: string;
  renderStatus: AnaliseLabRenderStatus;
  renderError?: string | null;
  renderProgress?: AnaliseLabRenderProgress | null;
  renderStartedAt?: string | null;
  renderFinishedAt?: string | null;
  cropVersao?: number;
}

export interface AnaliseLabMark {
  id: number;
  sessaoId: number;
  pagina: number;
  tipo: AnaliseLabMarkTipo | string;
  geometria: Record<string, number | string>;
  rotulo?: string | null;
  cor: AnaliseLabMarkCor | string;
  espelhar?: boolean;
  paginaOrigem?: number;
  cropVersao?: number;
}

export interface AnaliseLabInfo {
  ano: number;
  os: number;
  session: AnaliseLabSession | null;
  marks: AnaliseLabMark[];
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
}

export interface SaveAnaliseLabPayload {
  versao_label: string;
  modo: "unico" | "capa_miolo";
  arquivo_unico?: string | null;
  arquivo_capa?: string | null;
  arquivo_miolo?: string | null;
  crop_json?: ProvaWebCropJson | null;
}

export interface CreateAnaliseLabMarkPayload {
  pagina: number;
  tipo: AnaliseLabMarkTipo;
  geometria: Record<string, number | string>;
  rotulo?: string | null;
  cor?: AnaliseLabMarkCor;
  espelhar?: boolean;
  pagina_origem?: number;
}

export interface UpdateAnaliseLabMarkPayload {
  pagina?: number;
  geometria?: Record<string, number | string>;
  rotulo?: string | null;
  cor?: AnaliseLabMarkCor;
  espelhar?: boolean;
  pagina_origem?: number;
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

export type AnaliseLabModo = Extract<ProvaWebModo, "unico" | "capa_miolo">;
