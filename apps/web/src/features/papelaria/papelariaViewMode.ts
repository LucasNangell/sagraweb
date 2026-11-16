export type PapelariaViewMode = "previa" | "prova" | "imposicao";

export type ResolveDefaultPapelariaViewModeInput = {
  hasImposicao?: boolean;
  hasProof?: boolean;
  waitingApogee?: boolean;
};

/**
 * Modo inicial da visualização.
 * Prioridade: Imposição (arquivo ou aguardando Apogee) → Prova → Prévia.
 */
export function resolveDefaultPapelariaViewMode(
  input: boolean | ResolveDefaultPapelariaViewModeInput,
): PapelariaViewMode {
  // Compat com assinatura legada resolveDefaultPapelariaViewMode(hasProof).
  if (typeof input === "boolean") {
    return input ? "prova" : "previa";
  }
  if (input.waitingApogee || input.hasImposicao) {
    return "imposicao";
  }
  if (input.hasProof) {
    return "prova";
  }
  return "previa";
}
