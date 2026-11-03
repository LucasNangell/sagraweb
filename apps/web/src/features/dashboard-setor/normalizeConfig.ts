import { normalizeCardStyle } from "@/features/dashboard-setor-modern/cardStyle";

import { DEFAULT_DASHBOARD_CONFIG, INBOX_COLUMN_SOURCE } from "./constants";
import {
  normalizeNotificationSound,
  normalizeNotificationSounds,
} from "./notificationSounds";
import type {
  DashboardColumnConfig,
  DashboardConfig,
  DashboardTheme,
} from "./types";

function normalizeColumn(
  col: Partial<DashboardColumnConfig>,
  index: number,
): DashboardColumnConfig {
  const sector = typeof col.sector === "string" ? col.sector.trim() : "";
  const isInbox = col.source === INBOX_COLUMN_SOURCE;
  const headerBg = asThemeColor(col.headerBg);
  const headerBg2 = asThemeColor(col.headerBg2);
  return {
    id: col.id || `col_${index + 1}`,
    title: col.title || `Coluna ${index + 1}`,
    statuses: Array.isArray(col.statuses) ? col.statuses : [],
    ...(sector && !isInbox ? { sector } : {}),
    ...(col.hideWhenEmpty === true ? { hideWhenEmpty: true } : {}),
    ...(isInbox ? { source: INBOX_COLUMN_SOURCE } : {}),
    ...(headerBg ? { headerBg } : {}),
    ...(headerBg && headerBg2 ? { headerBg2 } : {}),
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

const DEFAULT_CARD_GAP = 8;

function asThemeColor(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)
    ? text
    : "";
}

function asCardGap(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.min(48, Math.max(0, Math.round(n)));
}

export function normalizeDashboardTheme(
  raw: unknown,
): DashboardTheme | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as DashboardTheme;
  const cardGap = asCardGap(parsed.cardGap);
  const pageBg = asThemeColor(parsed.pageBg);
  const columnBg = asThemeColor(parsed.columnBg);
  const headerBg = asThemeColor(parsed.headerBg);
  const headerBg2 = asThemeColor(parsed.headerBg2);
  const theme: DashboardTheme = {
    ...(cardGap != null && cardGap !== DEFAULT_CARD_GAP ? { cardGap } : {}),
    ...(pageBg ? { pageBg } : {}),
    ...(columnBg ? { columnBg } : {}),
    ...(headerBg ? { headerBg } : {}),
    ...(headerBg2 ? { headerBg2 } : {}),
  };
  return Object.keys(theme).length > 0 ? theme : undefined;
}

/** Omitido ou qualquer valor que não seja `false` mantém o relógio visível. */
export function showsAndamentoTime(
  config: Pick<DashboardConfig, "showAndamentoTime">,
): boolean {
  return config.showAndamentoTime !== false;
}

export function normalizeDashboardConfigFromRemote(
  remote: unknown,
  fallbackSector?: string | null,
): DashboardConfig {
  const parsed = (remote ?? {}) as Partial<DashboardConfig>;
  const columns = normalizeDashboardColumns(parsed.columns);
  const cardStyle = normalizeCardStyle(parsed.cardStyle);
  const theme = normalizeDashboardTheme(parsed.theme);
  const notificationSound = normalizeNotificationSound(parsed.notificationSound);
  const notificationSounds = normalizeNotificationSounds(
    parsed.notificationSounds,
  );
  return {
    sector:
      parsed.sector ||
      fallbackSector ||
      DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
    ...(parsed.showAndamentoTime === false ? { showAndamentoTime: false } : {}),
    ...(cardStyle ? { cardStyle } : {}),
    ...(theme ? { theme } : {}),
    ...(notificationSound ? { notificationSound } : {}),
    ...(notificationSounds ? { notificationSounds } : {}),
  };
}
