import { apiUrl } from "@/lib/api";
import type { ProvaWebManifestBase } from "@/api/provaWeb";
import type { PapelariaField } from "@/features/papelaria/types";

export interface ProofPortalPapelariaData {
  proof_id: number;
  job_id: number;
  modelo_id: number;
  job_dados: Record<string, string>;
  campos_formulario: PapelariaField[];
  preview_config_json?: string | null;
  tem_preview_config?: boolean;
  produto?: string;
  arquivo_modelo?: string;
  frente_verso?: string;
  /** Variante de cores do modelo/OS (ex.: Relev Seco, Policromia). */
  cores?: string;
  os_observ?: string;
}

export interface ProofPortalData {
  os: number;
  ano: number;
  versao: string;
  titulo: string;
  produto: string;
  solicitante: string;
  gabinete: string;
  hasPdf: boolean;
  arquivoNome?: string;
  isPapelaria?: boolean;
  /** Token de Prova WEB: visualização com folheamento das páginas. */
  isProvaWeb?: boolean;
  /** Cores da prova Papelaria (também em papelaria.cores quando há job). */
  cores?: string;
  papelaria?: ProofPortalPapelariaData;
}

export interface ProofPreviewPage {
  page: number;
  url: string;
}

export interface ProofPreviewPagesData {
  isPapelaria: boolean;
  pages: ProofPreviewPage[];
  total_pages: number;
  truncated?: boolean;
  mockupConfigJson?: string | null;
  produto?: string;
  arquivoModelo?: string;
  frenteVerso?: string;
}

async function proofApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && !parseErr.message.startsWith("API ")) {
        throw parseErr;
      }
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function proofPdfUrl(
  ano: number,
  osId: number,
  token: string,
  opts?: { parte?: "unico" | "capa" | "miolo" | string },
): string {
  const params = new URLSearchParams({ token });
  if (opts?.parte) {
    params.set("parte", opts.parte);
  }
  return apiUrl(`/client/proof/${ano}/${osId}/pdf?${params}`);
}

export function proofPreviewBaseUrl(
  ano: number,
  osId: number,
  token: string,
  faceId: string,
  versao?: string,
): string {
  const params = new URLSearchParams({ token });
  if (versao?.trim()) {
    params.set("v", versao.trim());
  }
  return apiUrl(
    `/client/proof/${ano}/${osId}/preview-base/${encodeURIComponent(faceId)}?${params}`,
  );
}

export async function fetchProofPortalData(
  ano: number,
  osId: number,
  token: string,
): Promise<ProofPortalData> {
  const params = new URLSearchParams({ token });
  return proofApiFetch(`/client/proof/${ano}/${osId}?${params}`);
}

export async function fetchProofPreviewPages(
  ano: number,
  osId: number,
  token: string,
): Promise<ProofPreviewPagesData> {
  const params = new URLSearchParams({ token });
  return proofApiFetch(`/client/proof/${ano}/${osId}/preview-pages?${params}`);
}

/** Manifest do flipbook da Prova WEB no escopo do token do cliente. */
export async function fetchProofFlipbookManifest(
  ano: number,
  osId: number,
  token: string,
): Promise<ProvaWebManifestBase> {
  const params = new URLSearchParams({ token });
  return proofApiFetch(`/client/proof/${ano}/${osId}/flipbook/manifest?${params}`);
}

export function proofFlipbookPageUrl(
  ano: number,
  osId: number,
  page: number,
  token: string,
  cacheKey?: string | null,
): string {
  const params = new URLSearchParams({ token });
  if (cacheKey) {
    params.set("v", cacheKey);
  }
  return apiUrl(`/client/proof/${ano}/${osId}/flipbook/pages/${page}.png?${params}`);
}

export function proofFlipbookAssetUrl(
  ano: number,
  osId: number,
  name: string,
  token: string,
  cacheKey?: string | null,
): string {
  const params = new URLSearchParams({ token });
  if (cacheKey) {
    params.set("v", cacheKey);
  }
  return apiUrl(
    `/client/proof/${ano}/${osId}/flipbook/assets/${encodeURIComponent(name)}?${params}`,
  );
}

function resolvePreviewImageUrl(raw: string): string {
  if (raw.startsWith("http")) return raw;
  const path = raw.replace(/^\/api/, "").replace(/^\/sagra\/api/, "");
  return apiUrl(path.startsWith("/") ? path : `/${path}`);
}

export function proofPreviewPageUrls(data: ProofPreviewPagesData): string[] {
  return data.pages.map((p) => resolvePreviewImageUrl(p.url));
}

export async function respondProof(body: {
  token: string;
  os_id: number;
  ano: number;
  aprovado: boolean;
  observacao?: string;
  nome_cliente: string;
  ponto: string;
  alteracoes_campos?: Record<string, string>;
}): Promise<{ status: string; aprovado: boolean }> {
  return proofApiFetch("/client/proof/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function uploadProofExampleFile(body: {
  token: string;
  os_id: number;
  ano: number;
  file: File;
}): Promise<{ status: string; filename: string; folder: string }> {
  const form = new FormData();
  form.append("token", body.token);
  form.append("os_id", String(body.os_id));
  form.append("ano", String(body.ano));
  form.append("file", body.file);

  const res = await fetch(apiUrl(`/client/proof/${body.ano}/${body.os_id}/upload-example`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && !parseErr.message.startsWith("API ")) {
        throw parseErr;
      }
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ status: string; filename: string; folder: string }>;
}
