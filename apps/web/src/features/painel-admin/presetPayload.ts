import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import type { DashboardConfig } from "@/features/dashboard-setor/types";
import { normalizeCardStyle } from "@/features/dashboard-setor-modern/cardStyle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Presets antigos gravavam só o visual dos cards (`models`). */
export function isLegacyCardStylePreset(payload: unknown): boolean {
  return isRecord(payload) && isRecord(payload.models) && !Array.isArray(payload.columns);
}

/** Aplica o payload do preset sobre a config atual (legado = só cardStyle). */
export function applyPresetPayload(
  current: DashboardConfig,
  payload: unknown,
): DashboardConfig {
  if (!isRecord(payload)) {
    return current;
  }
  if (isLegacyCardStylePreset(payload)) {
    const cardStyle = normalizeCardStyle(payload);
    return normalizeDashboardConfigFromRemote({
      ...current,
      ...(cardStyle ? { cardStyle } : {}),
    });
  }
  return normalizeDashboardConfigFromRemote({
    ...DEFAULT_DASHBOARD_CONFIG,
    ...payload,
  });
}
