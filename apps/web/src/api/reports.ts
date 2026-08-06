import { apiUrl } from "@/api/client";

import type { ReportRequest } from "@/features/relatorio/types";

async function parseReportError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    /* resposta não-JSON */
  }
  return text.trim() || `Erro HTTP ${res.status}`;
}

export async function generateCustomReportHtml(
  payload: ReportRequest,
): Promise<string> {
  const res = await fetch(apiUrl("/reports/custom"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/html" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseReportError(res));
  }
  return res.text();
}

export async function generateCustomReportXlsx(
  payload: ReportRequest,
): Promise<Blob> {
  const res = await fetch(apiUrl("/reports/custom/xlsx"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseReportError(res));
  }
  return res.blob();
}

export function downloadReportXlsx(blob: Blob): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Relatorio_Sagra_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  anchor.remove();
}

export function openReportHtml(htmlContent: string): boolean {
  const win = window.open("", "_blank");
  if (!win) {
    return false;
  }
  win.document.write(htmlContent);
  win.document.close();
  return true;
}
