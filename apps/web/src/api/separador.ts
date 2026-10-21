import { apiUrl } from "@/lib/api";

export interface SeparadorPdfInput {
  osLabel: string;
  until: number;
  titulo: string;
  solicitante: string;
  produto: string;
}

export async function fetchSeparadorCadernos(
  ano: number,
  nrOs: number,
): Promise<number | null> {
  try {
    const res = await fetch(apiUrl(`/reports/separador-cadernos/${ano}/${nrOs}`), {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { until?: number | null };
    return typeof data.until === "number" && data.until >= 1 ? data.until : null;
  } catch {
    return null;
  }
}

export async function fetchSeparadorPdf(input: SeparadorPdfInput): Promise<Blob> {
  const res = await fetch(apiUrl("/reports/separador.pdf"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/pdf",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      os_label: input.osLabel,
      until: input.until,
      titulo: input.titulo,
      solicitante: input.solicitante,
      produto: input.produto,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (err) {
      if (err instanceof Error && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
    throw new Error(`Falha ao gerar o PDF do separador (${res.status}).`);
  }
  return res.blob();
}
