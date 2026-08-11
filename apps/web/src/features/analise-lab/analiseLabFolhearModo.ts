export type AnaliseLabFolhearModo = "flipbook" | "folhas";

/** capa_miolo → flipbook; arquivo único → folhas. */
export function defaultFolhearModo(
  modo: string | null | undefined,
): AnaliseLabFolhearModo {
  return (modo || "").trim() === "capa_miolo" ? "flipbook" : "folhas";
}

export function normalizeFolhearModo(
  raw: string | null | undefined,
  modo?: string | null,
): AnaliseLabFolhearModo {
  const value = (raw || "").trim().toLowerCase();
  if (value === "flipbook" || value === "folhas") return value;
  return defaultFolhearModo(modo);
}
