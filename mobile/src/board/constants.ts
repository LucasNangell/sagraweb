import type { DashboardConfig } from "./types";

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  sector: "SEFOC",
  columnCount: 4,
  columns: [
    {
      id: "col_0",
      title: "p/ Triagem",
      statuses: [
        "Saída p/",
        "Saída parcial p/",
        "Entrada Inicial",
        "Tramit. de Prova p/",
        "Tramit. de Prévia p/",
        "Comentário",
      ],
    },
    {
      id: "col_1",
      title: "p/ Execução",
      statuses: ["Em Execução", "Recebido"],
    },
    {
      id: "col_2",
      title: "Prob. Téc.",
      statuses: ["Problemas Técnicos", "Problema Técnico"],
    },
    {
      id: "col_3",
      title: "enviar E-mail",
      statuses: ["Encam. de Docum."],
    },
  ],
};

export const DASHBOARD_NEW_HIGHLIGHT_MS = 30_000;
export const DASHBOARD_POLL_INTERVAL_MS = 300_000;
export const DASHBOARD_WS_FETCH_DEBOUNCE_MS = 300;
export const DASHBOARD_WS_DOWN_POLL_BASE_MS = 5_000;
export const DASHBOARD_WS_DOWN_POLL_MAX_MS = 30_000;

export const TABLET_FROZEN_SITUACOES = new Set([
  "Entregue",
  "Cancelada",
  "Cancelado",
]);

export const TABLET_DESKTOP_ONLY_SITUACOES = new Set([
  "Cancelada",
  "Cancelado",
  "Gravação Pendente",
]);

export const TABLET_PRIMARY_ANDAMENTOS = [
  "Recebido",
  "Em Execução",
  "Saída p/",
] as const;

export const TABLET_DESTINO_PREFIXES = [
  "Saída p/",
  "Saída parcial p/",
  "Tramit. de Prévia p/",
  "Tramit. de Prova p/",
] as const;

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

export function sortPtBr(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function isPrimaryAndamento(situacao: string): boolean {
  return (TABLET_PRIMARY_ANDAMENTOS as readonly string[]).includes(situacao);
}
