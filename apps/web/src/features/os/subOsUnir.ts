import type { SubOsRow } from "./types";

/** Setor comum quando há 2+ Sub OSs ativas no mesmo setor; senão null. */
export function sharedSetorIfAllTogether(
  subs: ReadonlyArray<Pick<SubOsRow, "setor_atual" | "setor">>,
): string | null {
  if (subs.length < 2) {
    return null;
  }
  const setores = subs.map((s) => (s.setor_atual ?? s.setor ?? "").trim());
  if (setores.some((s) => !s)) {
    return null;
  }
  const first = setores[0];
  return setores.every((s) => s === first) ? first : null;
}
