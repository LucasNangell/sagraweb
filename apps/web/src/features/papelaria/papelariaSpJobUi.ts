import type { PapelariaJobStatus } from "./types";

export type PapelariaSpJobUiStatus = "pending" | "generating" | "done";

export function papelariaSpJobUiKey(ano: number, nro: number): string {
  return `${ano}-${nro}`;
}

/** Mapeia status do job da API para o ícone da lista de SPs. */
export function papelariaSpJobUiFromJobStatus(
  status: PapelariaJobStatus | null | undefined,
): PapelariaSpJobUiStatus | null {
  if (status === "pending") return "pending";
  if (status === "processing") return "generating";
  if (status === "completed") return "done";
  return null;
}
