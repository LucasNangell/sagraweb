import type { GravacaoColumnId } from "./types";

export const GRAVACAO_COLUMN_TITLES: Record<GravacaoColumnId, string> = {
  grav_pendente: "Grav. Pendente",
  saida_grav_ext: "Saída p/ Grav. Ext.",
  recebido_grav_ext: "Recebido Grav. Ext.",
  grav_concluida: "Grav. Concluída",
};

export const GRAVACAO_PRIMARY_ANDAMENTOS = [
  "Recebido",
  "Saída parcial p/",
  "Saída p/",
] as const;

export const GRAVACAO_PANEL_SETOR = "Gravação";

export const GRAVACAO_DEFAULT_SETORES = ["SEIMP", "SEFOC", "SEGEP"] as const;

export const GRAVACAO_FROZEN_SITUACOES = new Set([
  "Entregue",
  "Cancelada",
  "Cancelado",
]);

export const GRAVACAO_WS_TYPES = new Set([
  "os_update",
  "system_update",
  "force_refresh",
  "gravacao_externa_sessao_criada",
  "gravacao_externa_iniciada",
  "gravacao_externa_concluida",
]);
