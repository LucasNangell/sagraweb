import type { PcpQueueItem } from "@/api/pcp";

export interface DashboardColumnConfig {
  id: string;
  title: string;
  statuses: string[];
  /** Omitido/vazio = herda config.sector */
  sector?: string;
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
  /** Coluna onde o card está exibido (detecta mudança de situação). */
  lastColumnId?: string | null;
  /** Timestamp até quando manter destaque verde. */
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
