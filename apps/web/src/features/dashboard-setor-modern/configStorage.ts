import { loadDashboardConfig } from "@/features/dashboard-setor/configStorage";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

export const MODERN_CONFIG_KEY = "sagra_dashboard_setor_moderno";

/** Importa a configuração atual na primeira abertura, sem gravar no painel original. */
export function loadModernDashboardConfig(
  userSector?: string | null,
): DashboardConfig {
  const saved = localStorage.getItem(MODERN_CONFIG_KEY);
  if (saved) {
    try {
      return normalizeDashboardConfigFromRemote(JSON.parse(saved), userSector);
    } catch {
      // Uma preferência local inválida não impede a abertura do painel.
    }
  }
  const config = loadDashboardConfig();
  return {
    ...config,
    sector:
      config.sector === DEFAULT_DASHBOARD_CONFIG.sector
        ? userSector || config.sector
        : config.sector,
  };
}

export function saveModernDashboardConfig(config: DashboardConfig): void {
  localStorage.setItem(MODERN_CONFIG_KEY, JSON.stringify(config));
}
