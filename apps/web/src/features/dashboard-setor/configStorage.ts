import { DASHBOARD_CONFIG_STORAGE_KEY, DEFAULT_DASHBOARD_CONFIG } from "./constants";
import { normalizeDashboardConfigFromRemote } from "./normalizeConfig";
import type { DashboardConfig } from "./types";

export const PAINEL_OS_CONFIG_STORAGE_KEY = "sagra_painel_os_config";

const LEGACY_CONFIG_KEYS = [
  "sagra_dashboard_setor_moderno",
  "sagra_dashboard_tablet_config",
] as const;

function looksLikeDashboardConfig(value: unknown): value is Partial<DashboardConfig> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const parsed = value as Partial<DashboardConfig>;
  return typeof parsed.sector === "string" && parsed.sector.trim().length > 0;
}

function readStoredConfig(raw: string | null): DashboardConfig | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!looksLikeDashboardConfig(parsed)) {
      return null;
    }
    return normalizeDashboardConfigFromRemote(parsed);
  } catch {
    return null;
  }
}

export function loadDashboardConfig(
  fallbackSector?: string | null,
): DashboardConfig {
  const current = readStoredConfig(
    localStorage.getItem(PAINEL_OS_CONFIG_STORAGE_KEY),
  );
  if (current) {
    return normalizeDashboardConfigFromRemote(current, fallbackSector);
  }

  for (const key of LEGACY_CONFIG_KEYS) {
    const migrated = readStoredConfig(localStorage.getItem(key));
    if (migrated) {
      const normalized = normalizeDashboardConfigFromRemote(
        migrated,
        fallbackSector,
      );
      saveDashboardConfig(normalized);
      return normalized;
    }
  }

  const fromSetorLegacy = readStoredConfig(
    localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY),
  );
  if (fromSetorLegacy) {
    const normalized = normalizeDashboardConfigFromRemote(
      fromSetorLegacy,
      fallbackSector,
    );
    saveDashboardConfig(normalized);
    return normalized;
  }

  return normalizeDashboardConfigFromRemote({
    ...DEFAULT_DASHBOARD_CONFIG,
    ...(fallbackSector ? { sector: fallbackSector } : {}),
  });
}

export function saveDashboardConfig(config: DashboardConfig): void {
  localStorage.setItem(
    PAINEL_OS_CONFIG_STORAGE_KEY,
    JSON.stringify(normalizeDashboardConfigFromRemote(config)),
  );
}

export function clearDashboardConfigCache(): void {
  localStorage.removeItem(PAINEL_OS_CONFIG_STORAGE_KEY);
}
