import type { ProvaWebFolhearModo } from "@/api/provaWeb";

/** Prova WEB: valor inválido ou ausente → livro (legado). */
export function normalizeProvaWebFolhearModo(
  raw: string | null | undefined,
): ProvaWebFolhearModo {
  const value = (raw || "").trim().toLowerCase();
  if (value === "flipbook" || value === "folhas") return value;
  return "flipbook";
}

export function shouldUseSheetsViewer(
  folhearModo: string | null | undefined,
): boolean {
  return normalizeProvaWebFolhearModo(folhearModo) === "folhas";
}
