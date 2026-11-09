import { apiFetch, apiUrl } from "@/api/client";
import {
  cancelLocalPdfCompare,
  downloadLocalPdfCompareReport,
  fetchLocalPdfCompareProgress,
  fetchLocalPdfCompareResult,
  probeLocalPdfCompare,
  startLocalPdfCompare,
} from "@/lib/sagraLocalOpener";

import type { CompareOptions, CompareProgress, CompareResult } from "./types";

export type CompareExecution = "local" | "server";

export interface StartComparePayload {
  previous_relative: string;
  current_relative: string;
  dpi: number;
  threshold: number;
  include_unchanged: boolean;
}

export interface StartCompareOutcome {
  session_id: string;
  message: string;
  execution: CompareExecution;
}

/** Junta root absoluto da OS com caminho relativo (Windows/UNC). */
export function joinOsAbsolutePath(
  rootPath: string,
  relative: string,
): string {
  const root = rootPath.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "").replace(/\//g, "\\");
  if (!rel) return root;
  return `${root}\\${rel}`;
}

export async function startPdfCompare(
  ano: number,
  osId: number,
  payload: StartComparePayload,
  absolutePaths?: { previous: string; current: string } | null,
): Promise<StartCompareOutcome> {
  if (absolutePaths?.previous && absolutePaths?.current) {
    const probe = await probeLocalPdfCompare();
    if (probe.ok) {
      try {
        const started = await startLocalPdfCompare({
          previousPath: absolutePaths.previous,
          currentPath: absolutePaths.current,
          previousRelative: payload.previous_relative,
          currentRelative: payload.current_relative,
          dpi: payload.dpi,
          threshold: payload.threshold,
          includeUnchanged: payload.include_unchanged,
          ano,
          osId,
        });
        return {
          session_id: started.session_id,
          message: started.message,
          execution: "local",
        };
      } catch {
        // Fallback silencioso para o servidor se o start local falhar.
      }
    }
  }

  try {
    const started = await apiFetch<{ session_id: string; message: string }>(
      `/os/${ano}/${osId}/pdf-compare/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return {
      session_id: started.session_id,
      message: started.message || "Comparação iniciada.",
      execution: "server",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/503|em andamento|ocupad/i.test(message)) {
      throw new Error(
        "O servidor já está processando outra comparação. Aguarde concluir ou use o Folder Opener 1.3 neste computador.",
      );
    }
    throw err;
  }
}

export async function fetchPdfCompareProgress(
  ano: number,
  osId: number,
  sessionId: string,
  execution: CompareExecution = "server",
): Promise<CompareProgress> {
  if (execution === "local") {
    const prog = await fetchLocalPdfCompareProgress(sessionId);
    return prog as CompareProgress;
  }
  return apiFetch(`/os/${ano}/${osId}/pdf-compare/${sessionId}/progress`);
}

export async function fetchPdfCompareResult(
  ano: number,
  osId: number,
  sessionId: string,
  execution: CompareExecution = "server",
): Promise<CompareResult> {
  if (execution === "local") {
    const data = await fetchLocalPdfCompareResult(sessionId);
    return data as unknown as CompareResult;
  }
  return apiFetch(`/os/${ano}/${osId}/pdf-compare/${sessionId}`);
}

export async function cancelPdfCompare(
  ano: number,
  osId: number,
  sessionId: string,
  execution: CompareExecution = "server",
): Promise<void> {
  if (execution === "local") {
    await cancelLocalPdfCompare(sessionId);
    return;
  }
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
  execution: CompareExecution = "server",
): Promise<void> {
  const downloadName = `comparacao-${ano}-${osId}.pdf`;
  if (execution === "local") {
    await downloadLocalPdfCompareReport(sessionId, includeUnchanged, downloadName);
    return;
  }
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
  a.download = downloadName;
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
