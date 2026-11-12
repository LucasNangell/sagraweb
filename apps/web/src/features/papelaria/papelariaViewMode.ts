export type PapelariaViewMode = "previa" | "prova";

/** Modo inicial da visualização: prova se já existir PDF; senão prévia. */
export function resolveDefaultPapelariaViewMode(
  hasProof: boolean,
): PapelariaViewMode {
  return hasProof ? "prova" : "previa";
}
