import { apiFetch, apiUrl } from "./client";

export type SequenciaConfidence = "automatic" | "review" | "manual";

export interface SequenciaProducaoBlock {
  id: string;
  title: string;
  lines: string[];
  confidence?: SequenciaConfidence;
  warnings?: string[];
}

export interface SequenciaProducaoSection {
  id: string;
  title: string;
  blocks: SequenciaProducaoBlock[];
  warnings?: string[];
}

export interface SequenciaProducaoDraft {
  version: number;
  os: {
    numero: number;
    ano: number;
    titulo?: string | null;
    produto?: string | null;
    formato?: string | null;
    tiragem?: number | null;
    paginas?: number | null;
  };
  source_hash: string;
  confidence?: SequenciaConfidence;
  warnings?: string[];
  sections: SequenciaProducaoSection[];
}

export interface SequenciaProducaoResponse {
  draft: SequenciaProducaoDraft;
  generated_source_hash: string;
  saved: boolean;
  source_changed: boolean;
  docx_filename?: string | null;
  docx_download_url?: string | null;
  updated_at?: string | null;
}

export interface SequenciaProducaoDocxResponse {
  filename: string;
  path: string;
  download_url: string;
}

export function fetchSequenciaProducao(
  ano: number,
  osId: number,
  options: { regenerate?: boolean } = {},
) {
  const qs = options.regenerate ? "?regenerate=true" : "";
  return apiFetch<SequenciaProducaoResponse>(
    `/os/${ano}/${osId}/sequencia-producao${qs}`,
  );
}

export function saveSequenciaProducao(
  ano: number,
  osId: number,
  draft: SequenciaProducaoDraft,
) {
  return apiFetch<SequenciaProducaoResponse>(
    `/os/${ano}/${osId}/sequencia-producao`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    },
  );
}

export function createSequenciaProducaoDocx(
  ano: number,
  osId: number,
  draft: SequenciaProducaoDraft,
) {
  return apiFetch<SequenciaProducaoDocxResponse>(
    `/os/${ano}/${osId}/sequencia-producao/docx`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, overwrite: true }),
    },
  );
}

export async function downloadSequenciaProducaoDocx(
  downloadUrl: string,
  filename: string,
) {
  const res = await fetch(apiUrl(downloadUrl), {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) {
    throw new Error("Não foi possível baixar o DOCX gerado.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
