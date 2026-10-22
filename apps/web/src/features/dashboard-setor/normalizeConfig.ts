import { DEFAULT_DASHBOARD_CONFIG, INBOX_COLUMN_SOURCE } from "./constants";
import type { DashboardColumnConfig, DashboardConfig } from "./types";

function normalizeColumn(
  col: Partial<DashboardColumnConfig>,
  index: number,
): DashboardColumnConfig {
  const sector = typeof col.sector === "string" ? col.sector.trim() : "";
  const isInbox = col.source === INBOX_COLUMN_SOURCE;
  return {
    id: col.id || `col_${index + 1}`,
    title: col.title || `Coluna ${index + 1}`,
    statuses: Array.isArray(col.statuses) ? col.statuses : [],
    ...(sector && !isInbox ? { sector } : {}),
    ...(col.hideWhenEmpty === true ? { hideWhenEmpty: true } : {}),
    ...(isInbox ? { source: INBOX_COLUMN_SOURCE } : {}),
  };
}

export function normalizeDashboardColumns(
  columns: Partial<DashboardColumnConfig>[] | undefined,
): DashboardColumnConfig[] {
  const source =
    columns && columns.length > 0
      ? columns
      : DEFAULT_DASHBOARD_CONFIG.columns;
  return source.map((col, index) => normalizeColumn(col, index));
}

export function normalizeDashboardConfigFromRemote(
  remote: unknown,
  fallbackSector?: string | null,
): DashboardConfig {
  const parsed = (remote ?? {}) as Partial<DashboardConfig>;
  const columns = normalizeDashboardColumns(parsed.columns);
  return {
    sector:
      parsed.sector ||
      fallbackSector ||
      DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
  };
}
