/** Digits-only ponto for comparisons (login vs andamento). */
export function cleanPonto(p: string | number | null | undefined): string {
  return String(p ?? "").replace(/\D/g, "");
}

export function isSefocSetor(setor: string | null | undefined): boolean {
  return String(setor ?? "").trim().toUpperCase() === "SEFOC";
}

/** Situações em que o usuário pode confirmar o início da análise. */
export function canPromptStartAnalise(
  situacao: string | null | undefined,
): boolean {
  const s = String(situacao ?? "").trim();
  if (!s) return false;
  if (s === "Em Execução") return true;
  return (
    s.startsWith("Saída p/") ||
    s.startsWith("Tramit. de Prévia p/") ||
    s.startsWith("Tramit. de Prova p/")
  );
}

/**
 * Preview of whether Análise would open in edit mode (assuming the user
 * would confirm start when prompted). Does not mutate andamentos.
 */
export function canEditAnalisePreview(params: {
  userSetor: string | null | undefined;
  situacao: string | null | undefined;
  lastPonto: string | null | undefined;
  currentPonto: string | null | undefined;
}): boolean {
  if (!isSefocSetor(params.userSetor)) {
    return false;
  }
  if (canPromptStartAnalise(params.situacao)) {
    return true;
  }
  const situacao = String(params.situacao ?? "").trim();
  if (situacao === "Recebido") {
    const lastClean = cleanPonto(params.lastPonto);
    const currentClean = cleanPonto(params.currentPonto);
    return Boolean(lastClean) && lastClean === currentClean;
  }
  if (situacao === "Problemas Técnicos") {
    return true;
  }
  return false;
}

export function isProblemasTecnicosSituacao(
  situacao: string | null | undefined,
): boolean {
  return String(situacao ?? "").trim() === "Problemas Técnicos";
}

export function hasProblemasTecnicosAndamento(
  rows: ReadonlyArray<{ SituacaoLink?: string | null }>,
): boolean {
  return rows.some((row) => isProblemasTecnicosSituacao(row.SituacaoLink));
}

export type AnaliseButtonMode = "fazer" | "revisar" | "ver";

/**
 * - "revisar": andamento atual é "Problemas Técnicos"
 * - "fazer": análise liberada para edição
 * - "ver": só visualização, e somente se já existir andamento "Problemas Técnicos"
 * - null: não exibir botão
 */
export function resolveAnaliseButtonMode(params: {
  canEdit: boolean;
  hasProblemasTecnicos: boolean;
  currentSituacao?: string | null;
}): AnaliseButtonMode | null {
  if (isProblemasTecnicosSituacao(params.currentSituacao)) return "revisar";
  if (params.canEdit) return "fazer";
  if (params.hasProblemasTecnicos) return "ver";
  return null;
}

export function analiseButtonCaption(mode: AnaliseButtonMode): string {
  if (mode === "revisar") return "Revisar análise";
  if (mode === "fazer") return "Fazer análise";
  return "Ver problemas";
}
