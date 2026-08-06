import {
  DASHBOARD_CONFIG_STORAGE_KEY,
  DEFAULT_DASHBOARD_CONFIG,
} from "./constants";
import type { DashboardConfig } from "./types";

export function loadDashboardConfig(): DashboardConfig {
  const saved = localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY);
  if (!saved) {
    return normalizeDashboardConfig(DEFAULT_DASHBOARD_CONFIG);
  }

  try {
    const parsed = JSON.parse(saved) as Partial<DashboardConfig>;
    const columns =
      parsed.columns && parsed.columns.length > 0
        ? parsed.columns
        : DEFAULT_DASHBOARD_CONFIG.columns;

    return normalizeDashboardConfig({
      sector: parsed.sector || DEFAULT_DASHBOARD_CONFIG.sector,
      columnCount: parsed.columnCount ?? columns.length,
      columns,
    });
  } catch {
    return normalizeDashboardConfig(DEFAULT_DASHBOARD_CONFIG);
  }
}

export function saveDashboardConfig(config: DashboardConfig): void {
  localStorage.setItem(
    DASHBOARD_CONFIG_STORAGE_KEY,
    JSON.stringify(normalizeDashboardConfig(config)),
  );
}

export function clearDashboardConfigCache(): void {
  localStorage.removeItem(DASHBOARD_CONFIG_STORAGE_KEY);
}

function normalizeDashboardConfig(config: DashboardConfig): DashboardConfig {
  const columns = config.columns.length > 0 ? config.columns : DEFAULT_DASHBOARD_CONFIG.columns;
  return {
    sector: config.sector || DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
  };
}
