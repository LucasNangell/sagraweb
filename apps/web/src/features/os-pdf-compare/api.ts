import { apiFetch, apiUrl } from "@/api/client";

import type { CompareOptions, CompareProgress, CompareResult } from "./types";

export interface StartComparePayload {
  previous_relative: string;
  current_relative: string;
  dpi: number;
  threshold: number;
  include_unchanged: boolean;
}

export async function startPdfCompare(
  ano: number,
  osId: number,
  payload: StartComparePayload,
): Promise<{ session_id: string; message: string }> {
  return apiFetch(`/os/${ano}/${osId}/pdf-compare/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchPdfCompareProgress(
  ano: number,
  osId: number,
  sessionId: string,
): Promise<CompareProgress> {
  return apiFetch(`/os/${ano}/${osId}/pdf-compare/${sessionId}/progress`);
}

export async function fetchPdfCompareResult(
  ano: number,
  osId: number,
  sessionId: string,
): Promise<CompareResult> {
  return apiFetch(`/os/${ano}/${osId}/pdf-compare/${sessionId}`);
}

export async function cancelPdfCompare(
  ano: number,
  osId: number,
  sessionId: string,
): Promise<void> {
  await apiFetch(`/os/${ano}/${osId}/pdf-compare/${sessionId}/cancel`, {
    method: "POST",
  });
}

export function pdfCompareAssetUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const stripped = pathOrUrl
    .replace(/^\/sagra\/api/, "")
    .replace(/^\/api/, "");
  return apiUrl(stripped.startsWith("/") ? stripped : `/${stripped}`);
}

export async function downloadPdfCompareReport(
  ano: number,
  osId: number,
  sessionId: string,
  includeUnchanged: boolean,
): Promise<void> {
  const url = apiUrl(`/os/${ano}/${osId}/pdf-compare/${sessionId}/report`);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/pdf",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ include_unchanged: includeUnchanged }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Falha ao baixar relatório (${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `comparacao-${ano}-${osId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function optionsToPayload(
  previousRelative: string,
  currentRelative: string,
  options: CompareOptions,
): StartComparePayload {
  return {
    previous_relative: previousRelative,
    current_relative: currentRelative,
    dpi: options.dpi,
    threshold: options.threshold,
    include_unchanged: options.includeUnchangedInReport,
  };
}
