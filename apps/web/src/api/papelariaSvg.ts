import { apiFetch, apiUrl } from "@/api/client";

import type { PapelariaField } from "@/features/papelaria/types";

export type PapelariaSvgModel = {
  codigo: string;
  nome: string;
  arquivo: string;
  categoria: string;
  face: string;
  ordem: number;
};

export type PapelariaSvgRenderResult = {
  codigo: string;
  arquivo: string;
  svg: string;
  warnings: string[];
};

export type PapelariaSvgRenderPayload = {
  codigo_modelo: string;
  dados: Record<string, string>;
};

async function parseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    /* não-JSON */
  }
  return text.trim() || `Erro HTTP ${res.status}`;
}

export async function fetchPapelariaSvgModelos(): Promise<PapelariaSvgModel[]> {
  return apiFetch<PapelariaSvgModel[]>("/papelaria/svg/modelos");
}

export async function fetchPapelariaSvgFields(
  codigo: string,
): Promise<PapelariaField[]> {
  const encoded = encodeURIComponent(codigo);
  return apiFetch<PapelariaField[]>(`/papelaria/svg/modelos/${encoded}/campos`);
}

export async function fetchPapelariaSvgPrefill(
  ano: number,
  nro: number,
): Promise<Record<string, string>> {
  const q = new URLSearchParams({
    ano: String(ano),
    nro: String(nro),
  });
  return apiFetch<Record<string, string>>(`/papelaria/svg/prefill?${q}`);
}

export async function renderPapelariaSvg(
  payload: PapelariaSvgRenderPayload,
): Promise<PapelariaSvgRenderResult> {
  return apiFetch<PapelariaSvgRenderResult>("/papelaria/svg/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function exportPapelariaSvg(
  payload: PapelariaSvgRenderPayload,
): Promise<Blob> {
  const res = await fetch(apiUrl("/papelaria/svg/export"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "image/svg+xml",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.blob();
}
