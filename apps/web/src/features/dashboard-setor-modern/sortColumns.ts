import type {
  DashboardDisplayColumn,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";
import {
  isInboxColumn,
  sortInboxItemsNewestFirst,
} from "@/features/dashboard-setor/utils";

import { parseAndamentoTime } from "./elapsed";

function protocolGroup(item: DashboardOsItem): number {
  const number = Number(item.parent_nr_os ?? item.nr_os);
  return Number.isFinite(number) && number < 5000 ? 0 : 1;
}

function priorityRank(item: DashboardOsItem): number {
  const priority = item.prioridade?.toLocaleLowerCase("pt-BR") ?? "";
  if (priority.includes("prometido")) return 0;
  if (priority.includes("solicitado")) return 1;
  return 2;
}

function compareItems(a: DashboardOsItem, b: DashboardOsItem): number {
  const group = protocolGroup(a) - protocolGroup(b);
  if (group) return group;
  const priority = priorityRank(a) - priorityRank(b);
  if (priority) return priority;
  const timeA = parseAndamentoTime(a.last_update, a.observacao);
  const timeB = parseAndamentoTime(b.last_update, b.observacao);
  if (timeA !== timeB) {
    if (timeA == null) return 1;
    if (timeB == null) return -1;
    return timeA - timeB;
  }
  return a.uniqueKey.localeCompare(b.uniqueKey, "pt-BR", { numeric: true });
}

/** Ordem de exibição do painel moderno, independente da sequência manual do PCP. */
export function sortModernDashboardColumns(
  columns: DashboardDisplayColumn[],
): DashboardDisplayColumn[] {
  return columns.map((column) => ({
    ...column,
    items: [...column.items].sort(
      isInboxColumn(column) ? sortInboxItemsNewestFirst : compareItems,
    ),
  }));
}
