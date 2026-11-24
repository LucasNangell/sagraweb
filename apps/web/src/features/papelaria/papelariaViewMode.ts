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

/** Situação «Saída p/» (prefixo, como em analiseAccess): SP chegou para trabalhar. */
export function situacaoSaidaPara(situacao: string | null | undefined): boolean {
  return (situacao ?? "").trim().toLowerCase().startsWith("saída p/");
}

export type ResolverVisualizacaoInicialInput = {
  /** Situação atual da SP (andamento). */
  situacao?: string | null;
  /** Fase da prova (`approved` = aprovada pelo cliente). */
  faseProva?: string | null;
  hasProof?: boolean;
  hasImposicao?: boolean;
  waitingApogee?: boolean;
  /** Prova sendo gerada (job na fila/processando). */
  jobEmAndamento?: boolean;
};

/**
 * Visualização ao abrir a SP:
 * 1. trabalho em andamento → acompanhamento (prova gerando; imposição no Apogee);
 * 2. «Saída p/» sem prova aprovada pelo cliente (trabalho novo ou pedido de
 *    alteração) → prévia;
 * 3. demais situações → última prova (se houver), senão prévia.
 */
export function resolverVisualizacaoInicial(input: ResolverVisualizacaoInicialInput): PapelariaViewMode {
  if (input.jobEmAndamento) return "prova";
  if (input.waitingApogee) return "imposicao";
  if (situacaoSaidaPara(input.situacao) && input.faseProva !== "approved") return "previa";
  return input.hasProof ? "prova" : "previa";
}
