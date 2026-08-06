export interface PcpQueueItem {
  nr_os: number;
  ano: number;
  titulo?: string | null;
  produto?: string | null;
  formato?: string | null;
  tiragem?: number | null;
  pags?: number | null;
  situacao?: string | null;
  setor?: string | null;
  data_entrega?: string | null;
  entreg_periodo?: string | null;
  prioridade?: string | null;
  nome_usuario?: string | null;
  last_update?: string | null;
  observacao?: string | null;
  pcp_ordem?: number | null;
  pcp_ultima_atualizacao?: string | null;
  row_kind?: "main_os" | "sub_os";
  sub_os_id?: number;
  display_label?: string | null;
  componente_nome?: string | null;
  parent_nr_os?: number;
  parent_ano?: number;
}

export interface DashboardColumnConfig {
  id: string;
  title: string;
  statuses: string[];
}

export interface DashboardConfig {
  sector: string;
  columnCount: number;
  columns: DashboardColumnConfig[];
}

export type DashboardPriorityType = "priority-high" | "priority-medium" | null;

export interface DashboardOsItem extends PcpQueueItem {
  uniqueKey: string;
  priorityType: DashboardPriorityType;
  isNew: boolean;
  displaySituacao: string;
  pcp_ordem: number | null;
  lastColumnId?: string | null;
  highlightUntil?: number;
}

export interface DashboardDisplayColumn extends DashboardColumnConfig {
  items: DashboardOsItem[];
}

export interface DashboardWsMessage {
  type?: string;
  setor?: string;
  id?: number;
  ano?: number;
  action?: string;
  situacao?: string;
  sub_os_id?: number;
}
