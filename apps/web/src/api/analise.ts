import { apiFetch, apiUrl } from "@/api/client";

import type {
  AnaliseFullResponse,
  AnaliseSelectedItem,
  OsVersionsResponse,
  ProblemaPadrao,
  UltimoAndamento,
} from "@/features/analise/types";

export async function fetchProblemasPadrao(): Promise<ProblemaPadrao[]> {
  const raw = await apiFetch<Record<string, unknown>[]>("/analise/problemas-padrao");
  return raw.map(normalizeProblemaPadrao);
}

function normalizeProblemaPadrao(raw: Record<string, unknown>): ProblemaPadrao {
  return {
    ID: Number(raw.ID ?? raw.id ?? 0),
    TituloPT: String(raw.TituloPT ?? raw.titulopt ?? raw.titulo ?? ""),
    ProbTecHTML: String(raw.ProbTecHTML ?? raw.probtechhtml ?? raw.html ?? ""),
    Categoria: String(raw.Categoria ?? raw.categoria ?? "Geral"),
  };
}

export async function addProblemaPadrao(payload: {
  titulo: string;
  html_snapshot: string;
  categoria?: string;
}): Promise<{ status: string; id: number; titulo: string }> {
  return apiFetch("/analise/problemas-padrao/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateProblemaPadrao(
  id: number,
  payload: {
    titulo: string;
    html_snapshot: string;
    categoria?: string;
  },
): Promise<{ status: string; id: number; titulo: string; categoria: string }> {
  return apiFetch(`/analise/problemas-padrao/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteProblemaPadrao(
  id: number,
): Promise<{ status: string; id: number }> {
  return apiFetch(`/analise/problemas-padrao/${id}`, {
    method: "DELETE",
  });
}

export async function ensureAnalise(payload: {
  nro_os: number;
  ano_os: number;
  usuario: string;
}): Promise<{ id: number; new: boolean }> {
  return apiFetch("/analise/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchAnaliseFull(
  ano: number,
  osId: number,
): Promise<AnaliseFullResponse> {
  return apiFetch<AnaliseFullResponse>(`/analise/${ano}/${osId}/full`);
}

/** Grava versão analisada e componente (portal client_pt usa Versao do banco). */
export async function updateAnaliseMeta(
  ano: number,
  osId: number,
  payload: { versao?: string; componente?: string },
): Promise<{ status: string }> {
  return apiFetch(`/analise/${ano}/${osId}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function addAnaliseItem(payload: {
  id_analise: number;
  id_padrao: number;
  componente: string;
  versao?: string;
  obs?: string;
  html_snapshot?: string;
}): Promise<{ id: number }> {
  return apiFetch("/analise/item/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateAnaliseItem(payload: {
  id_item: number;
  obs?: string;
  html_snapshot?: string;
  componente?: string;
}): Promise<{ status: string }> {
  return apiFetch("/analise/item/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteAnaliseItem(itemId: number): Promise<{ status: string }> {
  return apiFetch(`/analise/item/${encodeURIComponent(String(itemId))}/delete`, {
    method: "POST",
  });
}

export async function toggleResolucaoObrigatoria(payload: {
  id_item: number;
  resolucao_obrigatoria: boolean;
}): Promise<{ status: string; resolucao_obrigatoria: boolean }> {
  return apiFetch("/analise/item/toggle-resolucao-obrigatoria", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function toggleCorrigidoSefoc(payload: {
  id_item: number;
  corrigido_sefoc: boolean;
  obs_correcao_sefoc?: string;
}): Promise<{
  status: string;
  corrigido_sefoc: boolean;
  obs_correcao_sefoc: string;
}> {
  return apiFetch("/analise/item/toggle-corrigido-sefoc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchOsVersions(ano: number, osId: number): Promise<OsVersionsResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
    return await apiFetch<OsVersionsResponse>(`/os/${ano}/${osId}/versions`, {
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "Tempo esgotado ao carregar versões. Verifique o acesso à pasta da OS na rede.",
      );
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchUltimoAndamento(
  ano: number,
  osId: number,
): Promise<UltimoAndamento> {
  return apiFetch<UltimoAndamento>(`/os/${ano}/${osId}/ultimo-andamento`);
}

export async function startAnalise(payload: {
  os_id: number;
  ano: number;
  ponto: string;
  usuario: string;
}): Promise<{ status: string }> {
  return apiFetch("/analise/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function generateAnaliseLink(
  ano: number,
  osId: number,
  versao: string,
  usuario?: string,
): Promise<{ url: string }> {
  return apiFetch(`/analise/${ano}/${osId}/generate-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versao, usuario }),
  });
}

export async function registerLinkMovement(payload: {
  os_id: number;
  ano: number;
  usuario: string;
  link: string;
  versao: string;
  observacao?: string;
}): Promise<{ status: string }> {
  return apiFetch("/analise/client/register-link-movement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function registerPtvDispatch(payload: {
  os_id: number;
  ano: number;
  usuario: string;
  versao: string;
  observacao?: string;
}): Promise<{ status: string }> {
  return apiFetch("/analise/register-ptv-dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function registerExecutionMovement(payload: {
  os_id: number;
  ano: number;
  observacao: string;
  ponto: string;
}): Promise<{ status: string; message?: string }> {
  return apiFetch("/analise/register-execution-movement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listAnaliseFiles(path: string): Promise<{ files: { name: string; path: string; type: string }[] }> {
  const q = new URLSearchParams({ path });
  return apiFetch(`/files/list?${q}`);
}

export function analiseFileServeUrl(filepath: string): string {
  const q = new URLSearchParams({ filepath });
  return apiUrl(`/files/serve?${q}`);
}

/** URL absoluta da API para imagem de indicação salva em disco. */
export function analiseIndicationImageUrl(itemId: number, filename: string): string {
  return apiUrl(
    `/analise/item/${itemId}/indication/${encodeURIComponent(filename)}`,
  );
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error("Imagem de indicação inválida.");
  }
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mimeMatch = /data:([^;]+);/i.exec(header);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (!bytes.length) {
    throw new Error("Imagem de indicação vazia.");
  }
  return new Blob([bytes], { type: mime });
}

/** Envia captura de indicação ao servidor e retorna URL relativa /api/... para o HTML. */
export async function uploadAnaliseIndicationImage(
  itemId: number,
  dataUrl: string,
): Promise<{ url: string; filename: string }> {
  const src = dataUrl.trim();
  if (!src.startsWith("data:image/")) {
    throw new Error("Imagem de indicação inválida.");
  }
  const blob = dataUrlToBlob(src);
  const ext = blob.type.includes("png") ? "indicacao.png" : "indicacao.jpg";
  const fd = new FormData();
  fd.append("file", blob, ext);
  const res = await apiFetch<{ url: string; filename: string }>(
    `/analise/item/${itemId}/indication-image`,
    { method: "POST", body: fd },
  );
  const path = res.url.startsWith("/api/") || res.url.startsWith("/sagra/api/")
    ? res.url
    : res.url.startsWith("/")
      ? `/api${res.url}`
      : `/api/${res.url.replace(/^\//, "")}`;
  return { filename: res.filename, url: path.replace(/^\/sagra\/api/, "/api") };
}

/** Normaliza itens vindos da API para o shape usado na UI. */
export function mapAnaliseItems(
  raw: AnaliseFullResponse["items"],
): AnaliseSelectedItem[] {
  if (!raw?.length) return [];
  return raw.map((item) => ({
    uniqueId: item.uniqueId,
    originalId: item.originalId,
    titulo: item.titulo ?? "Item",
    html: item.html ?? "",
    obs: item.obs ?? "",
    componenteOrigem: item.componenteOrigem ?? "Geral",
    versaoOrigem:
      item.versaoOrigem != null && String(item.versaoOrigem).trim()
        ? String(item.versaoOrigem).trim()
        : undefined,
    resolucaoObrigatoria: Boolean(item.resolucaoObrigatoria),
    corrigidoSefoc: Boolean(item.corrigidoSefoc),
    obsCorrecaoSefoc: item.obsCorrecaoSefoc ?? "",
  }));
}
