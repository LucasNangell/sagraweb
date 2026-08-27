import { apiFetch, apiUrl } from "@/api/client";

import type { OrcamentoEntrada, OrcamentoResponse } from "@/features/orcamento/types";

export async function fetchOrcamentoOs(
  ano: number,
  osId: number,
): Promise<OrcamentoResponse> {
  return apiFetch(`/orcamento/os/${ano}/${osId}`);
}

export async function calcularOrcamento(
  payload: OrcamentoEntrada,
): Promise<OrcamentoResponse> {
  return apiFetch("/orcamento/calcular", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

export async function gerarOrcamentoPdf(
  payload: OrcamentoEntrada,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(apiUrl("/orcamento/pdf"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/pdf",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Erro HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const os = payload.os;
  const fallback = `Orcamento_OS_${os.nro_protocolo}_${os.ano_protocolo}.pdf`;
  return {
    blob,
    filename: filenameFromDisposition(res.headers.get("Content-Disposition"), fallback),
  };
}

export function downloadOrcamentoPdf(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}
