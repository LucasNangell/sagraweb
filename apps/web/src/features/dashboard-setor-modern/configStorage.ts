import {
  loadDashboardConfig,
  saveDashboardConfig,
} from "@/features/dashboard-setor/configStorage";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

export const MODERN_CONFIG_KEY = "sagra_dashboard_setor_moderno";

export function loadModernDashboardConfig(
  userSector?: string | null,
): DashboardConfig {
  return loadDashboardConfig(userSector);
}

export function saveModernDashboardConfig(config: DashboardConfig): void {
  saveDashboardConfig(config);
}
