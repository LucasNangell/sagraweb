import {
  DEFAULT_DASHBOARD_CONFIG,
} from "@/features/dashboard-setor/constants";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

import { TABLET_CONFIG_STORAGE_KEY } from "./constants";

function normalizeDashboardConfig(config: DashboardConfig): DashboardConfig {
  const columns =
    config.columns.length > 0 ? config.columns : DEFAULT_DASHBOARD_CONFIG.columns;
  return {
    sector: config.sector || DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
  };
}

export function loadTabletDashboardConfig(): DashboardConfig {
  const saved = localStorage.getItem(TABLET_CONFIG_STORAGE_KEY);
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

export function saveTabletDashboardConfig(config: DashboardConfig): void {
  localStorage.setItem(
    TABLET_CONFIG_STORAGE_KEY,
    JSON.stringify(normalizeDashboardConfig(config)),
  );
}

export function clearTabletDashboardConfigCache(): void {
  localStorage.removeItem(TABLET_CONFIG_STORAGE_KEY);
}
