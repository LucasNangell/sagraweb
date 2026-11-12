/** Preferência local das situações exibidas na lista de SPs da Papelaria. */
export const PAPELARIA_SP_SITUACOES_KEY = "sagra_papelaria_sp_situacoes";

export function loadPapelariaSpSituacoes(): string[] {
  try {
    const raw = localStorage.getItem(PAPELARIA_SP_SITUACOES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function savePapelariaSpSituacoes(situacoes: string[]): void {
  const cleaned = [
    ...new Set(
      situacoes
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  localStorage.setItem(PAPELARIA_SP_SITUACOES_KEY, JSON.stringify(cleaned));
}
