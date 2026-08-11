import type { DashboardConfig } from "./types";

export const DASHBOARD_CONFIG_STORAGE_KEY = "sagra_dashboard_config";

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

/** Destaque verde (border-left) de OS nova ou que mudou de coluna. */
export const DASHBOARD_NEW_HIGHLIGHT_MS = 30_000;
export const DASHBOARD_POLL_INTERVAL_MS = 60_000;
export const DASHBOARD_WS_FETCH_DEBOUNCE_MS = 300;
/** Polling fixo sem WS (borda Envoy sem Upgrade). */
export const DASHBOARD_WS_DOWN_POLL_BASE_MS = 10_000;
export const DASHBOARD_WS_DOWN_POLL_MAX_MS = 10_000;
/** WS conectado: dado fresco se sincronizado dentro do poll de segurança (60s) + folga. */
export const DASHBOARD_STALE_LIVE_MS = 90_000;
/** Sem WS: dado fresco se sincronizado dentro de alguns ciclos de poll (10s) + folga. */
export const DASHBOARD_STALE_POLL_MS = 45_000;
/** Reavaliação do indicador de frescor. */
export const DASHBOARD_FRESHNESS_TICK_MS = 5_000;
