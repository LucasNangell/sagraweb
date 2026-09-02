/**
 * Stable `data-testid` values (HTML `data-*`, Playwright/Testing Library convention).
 * Do not use these as HTML `id` — document uniqueness is not required here.
 */

function slug(value: string | number): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Join parts into a kebab-case test id. Empty/blank parts are omitted. */
export function testId(
  ...parts: Array<string | number | null | undefined>
): string {
  return parts
    .map((part) => (part == null || part === "" ? "" : slug(part)))
    .filter(Boolean)
    .join("-");
}

/** Sidebar nav item from route (`to`) or action. `/` → `inicio`. */
export function sidebarNavTestId(to?: string, action?: string): string {
  if (action === "lombada-calculator") {
    return "sidebar-nav-lombada";
  }
  if (!to || to === "/") {
    return "sidebar-nav-inicio";
  }
  return testId("sidebar-nav", to.replace(/^\//, ""));
}

export const homeTestIds = {
  sidebar: "sidebar",
  sidebarCollapse: "sidebar-collapse",
  sidebarHelp: "sidebar-help",
  sidebarHelpManual: "sidebar-help-manual",
  sidebarHelpTutorial: "sidebar-help-tutorial",
  sidebarHelpTutorialItem: (tourId: string) =>
    testId("sidebar-help-tutorial", tourId),
  sidebarHelpSupport: "sidebar-help-suporte",

  headerLogout: "header-logout",
  headerNotifications: "header-notifications",
  headerNotificationsDismiss: "header-notifications-dismiss",
  headerNotificationsOpen: "header-notifications-open",
  headerNotificationsConversation: "header-notifications-conversation",
  headerNotificationItem: (id: string | number) =>
    testId("header-notification-item", id),
  headerNotificationDetail: "header-notification-detail",
  headerNotificationDetailClose: "header-notification-detail-close",
  headerNotificationDetailConversation:
    "header-notification-detail-conversation",
  headerNotificationDetailOk: "header-notification-detail-ok",

  guidedTourExit: "guided-tour-exit",
  guidedTourNext: "guided-tour-next",

  lombadaRoot: "lombada-root",
  lombadaClose: "lombada-close",
  lombadaPages: "lombada-pages",
  lombadaCoverPaper: "lombada-cover-paper",
  lombadaBodyPaper: "lombada-body-paper",
  lombadaDiff: "lombada-diff",
  lombadaUseInObs: "lombada-use-in-obs",

  osTabLista: "os-tab-lista",
  osTabDetalhes: "os-tab-detalhes",
  osTabAndamentos: "os-tab-andamentos",

  osFiltersExpand: "os-filters-expand",
  osFiltersOs: "os-filters-os",
  osFiltersSp: "os-filters-sp",
  osFiltersCreate: "os-filters-create",
  osFiltersSaved: "os-filters-saved",
  osFiltersNrOs: "os-filters-nr-os",
  osFiltersProcesso: "os-filters-processo",
  osFiltersTitulo: "os-filters-titulo",
  osFiltersAno: "os-filters-ano",
  osFiltersCategoria: "os-filters-categoria",
  osFiltersMaquina: "os-filters-maquina",
  osFiltersPrioridade: "os-filters-prioridade",
  osFiltersSetor: "os-filters-setor",
  osFiltersSituacao: "os-filters-situacao",
  osFiltersNome: "os-filters-nome",
  osFiltersProduto: "os-filters-produto",
  osFiltersClear: "os-filters-clear",
  osFiltersRefresh: "os-filters-refresh",

  osTable: "os-table",
  osTableSort: (column: string) => testId("os-table-sort", column),
  osTableRow: (ano: number | string, nrOs: number | string) =>
    testId("os-table-row", ano, nrOs),
  osTableExpand: (ano: number | string, nrOs: number | string) =>
    testId("os-table-expand", ano, nrOs),
  osTableReport: "os-table-report",

  osDetails: (field: string) => testId("os-details", field),

  osHistoryPanel: "os-history-panel",
  osHistorySituacao: "os-history-situacao",
  osHistorySetor: "os-history-setor",
  osHistoryPonto: "os-history-ponto",
  osHistoryObs: "os-history-obs",
  osHistoryObsHora: "os-history-obs-hora",
  osHistoryComponente: "os-history-componente",
  osHistoryNovo: "os-history-novo",
  osHistorySalvar: "os-history-salvar",
  osHistoryExcluir: "os-history-excluir",
  osHistoryEditar: "os-history-editar",
  osHistoryCancelar: "os-history-cancelar",
  osHistoryAnalise: "os-history-analise",
  osHistoryAlterarArquivos: "os-history-alterar-arquivos",
  osHistoryRow: (id: string | number) => testId("os-history-row", id),

  osContext: (actionId: string) => testId("os-context", actionId),

  osSettingsRoot: "os-settings-root",
  osSettingsClose: "os-settings-close",
  osSettingsName: "os-settings-name",
  osSettingsSave: "os-settings-save",
  osSettingsDelete: "os-settings-delete",
  osSettingsDefault: "os-settings-default",

  osGerenciaRoot: "os-gerencia-root",
  osGerenciaClose: "os-gerencia-close",
  osGerenciaSection: (id: string) => testId("os-gerencia-section", id),
  osGerenciaSave: "os-gerencia-save",
  osGerenciaEdit: "os-gerencia-edit",
  osGerenciaCancel: "os-gerencia-cancel",
  osGerenciaPrint: "os-gerencia-print",
  osGerenciaNew: "os-gerencia-new",
  osGerenciaDuplicate: "os-gerencia-duplicate",
  osGerenciaVincular: "os-gerencia-vincular",

  gerenciaField: (field: string) => testId("gerencia", field),

  osArquivosRoot: "os-arquivos-root",
  osArquivosClose: "os-arquivos-close",
  osArquivosConfirm: "os-arquivos-confirm",
  osArquivosSkip: "os-arquivos-skip",

  osAuditRoot: "os-audit-root",
  osAuditClose: "os-audit-close",

  osVincularRoot: "os-vincular-root",
  osVincularClose: "os-vincular-close",
  osVincularConfirm: "os-vincular-confirm",
  osVincularCancel: "os-vincular-cancel",
  osVincularAddAndamento: "os-vincular-add-andamento",
  osVincularSaveAndamentos: "os-vincular-save-andamentos",
  osVincularAndamentoRow: (index: number) =>
    testId("os-vincular-andamento", index),

  osNotificarRoot: "os-notificar-root",
  osNotificarClose: "os-notificar-close",
  osNotificarSend: "os-notificar-send",
  osNotificarCancel: "os-notificar-cancel",

  osMoverRoot: "os-mover-root",
  osMoverClose: "os-mover-close",
  osMoverConfirm: "os-mover-confirm",
  osMoverCancel: "os-mover-cancel",

  osFolderRoot: "os-folder-root",
  osFolderClose: "os-folder-close",
  osFolderOpen: "os-folder-open",
  osFolderCreate: "os-folder-create",

  osPrintRoot: "os-print-root",
  osPrintClose: "os-print-close",
  osPrintConfirm: "os-print-confirm",
  osPrintFichaRoot: "os-print-ficha-root",
  osPrintFichaClose: "os-print-ficha-close",

  osSaidaRoot: "os-saida-root",
  osSaidaClose: "os-saida-close",
  osSaidaConfirm: "os-saida-confirm",
  osSaidaCancel: "os-saida-cancel",

  osUnirSubOsRoot: "os-unir-sub-os-root",
  osUnirSubOsConfirm: "os-unir-sub-os-confirm",
  osUnirSubOsCancel: "os-unir-sub-os-cancel",

  osEntregaRoot: "os-entrega-root",
  osEntregaClose: "os-entrega-close",
  osEntregaConfirm: "os-entrega-confirm",
  osEntregaCancel: "os-entrega-cancel",

  osGravacaoRoot: "os-gravacao-root",
  osGravacaoClose: "os-gravacao-close",
  osGravacaoConfirm: "os-gravacao-confirm",
  osGravacaoCancel: "os-gravacao-cancel",
  osGravacaoConcluirRoot: "os-gravacao-concluir-root",
  osGravacaoConcluirClose: "os-gravacao-concluir-close",
  osGravacaoConcluirConfirm: "os-gravacao-concluir-confirm",
  osGravacaoConcluirCancel: "os-gravacao-concluir-cancel",

  supportAssignedRoot: "support-assigned-root",
  supportAssignedClose: "support-assigned-close",
  supportAssignedSend: "support-assigned-send",
} as const;
