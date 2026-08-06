import { DEFAULT_DASHBOARD_CONFIG } from "./constants";
import type { DashboardConfig } from "./types";

export function normalizeDashboardConfigFromRemote(
  remote: unknown,
  fallbackSector?: string | null,
): DashboardConfig {
  const parsed = (remote ?? {}) as Partial<DashboardConfig>;
  const columns =
    parsed.columns && parsed.columns.length > 0
      ? parsed.columns
      : DEFAULT_DASHBOARD_CONFIG.columns;
  return {
    sector:
      parsed.sector ||
      fallbackSector ||
      DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
  };
}
