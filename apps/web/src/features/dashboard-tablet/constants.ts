export const TABLET_CONFIG_STORAGE_KEY = "sagra_dashboard_tablet_config";

/** OS já finalizada — sem novos andamentos no tablet. */
export const TABLET_FROZEN_SITUACOES = new Set([
  "Entregue",
  "Cancelada",
  "Cancelado",
]);

/** Situações que só podem ser lançadas no desktop. */
export const TABLET_DESKTOP_ONLY_SITUACOES = new Set([
  "Cancelada",
  "Cancelado",
  "Gravação Pendente",
]);

/** Atalhos fixos no painel direito (ordem de exibição). */
export const TABLET_PRIMARY_ANDAMENTOS = [
  "Recebido",
  "Em Execução",
  "Saída p/",
  "Entregue",
] as const;

/** Andamentos que exigem escolha de setor de destino. */
export const TABLET_DESTINO_PREFIXES = [
  "Saída p/",
  "Saída parcial p/",
  "Tramit. de Prévia p/",
  "Tramit. de Prova p/",
] as const;

/** Setores padrão (serão ordenados alfabeticamente na UI). */
export const TABLET_DEFAULT_SETORES = [
  "SEFOC",
  "SIELT",
  "SEPAC",
  "SEIMP",
  "SEGEP",
  "Expedição",
  "Correspondência",
] as const;

export function requiresDestinoSetor(situacao: string): boolean {
  const s = situacao.trim();
  if (!s) return false;
  return TABLET_DESTINO_PREFIXES.some(
    (prefix) => s === prefix || s.startsWith(prefix),
  );
}

export function isEntregueSituacao(situacao: string): boolean {
  return situacao.trim() === "Entregue";
}

export function requiresProtocoloEntrega(situacao: string): boolean {
  return isEntregueSituacao(situacao);
}

export function sortPtBr(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function isPrimaryAndamento(situacao: string): boolean {
  return (TABLET_PRIMARY_ANDAMENTOS as readonly string[]).includes(situacao);
}
