import {
  clearDashboardConfigCache,
  loadDashboardConfig,
  saveDashboardConfig,
} from "@/features/dashboard-setor/configStorage";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

export function loadTabletDashboardConfig(
  fallbackSector?: string | null,
): DashboardConfig {
  return loadDashboardConfig(fallbackSector);
}

export function saveTabletDashboardConfig(config: DashboardConfig): void {
  saveDashboardConfig(config);
}

export function clearTabletDashboardConfigCache(): void {
  clearDashboardConfigCache();
}
