import { useEffect, useState } from "react";

import type { WebSocketStatus } from "@/hooks/useSagraWebSocket";

import {
  DASHBOARD_FRESHNESS_TICK_MS,
  DASHBOARD_STALE_LIVE_MS,
  DASHBOARD_STALE_POLL_MS,
} from "../constants";

export type DashboardFreshnessLevel =
  | "loading"
  | "live"
  | "degraded"
  | "stale";

export interface DashboardFreshness {
  level: DashboardFreshnessLevel;
  /** Classe CSS do indicador: connected | degraded | disconnected */
  statusClass: "connected" | "degraded" | "disconnected";
  label: string;
}

export interface UseDashboardFreshnessOptions {
  hasLoadedOnce: boolean;
  lastSyncAt: number | null;
  wsStatus: WebSocketStatus;
  fetchError?: string | null;
  /** Override para testes. */
  now?: number;
}

function formatSyncTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("pt-BR");
}

export function computeDashboardFreshness(
  options: UseDashboardFreshnessOptions,
): DashboardFreshness {
  const {
    hasLoadedOnce,
    lastSyncAt,
    wsStatus,
    fetchError = null,
    now = Date.now(),
  } = options;

  if (!hasLoadedOnce || lastSyncAt == null) {
    return {
      level: "loading",
      statusClass: "disconnected",
      label: "Carregando dados",
    };
  }

  const ageMs = Math.max(0, now - lastSyncAt);
  const wsConnected = wsStatus === "connected";
  const timeLabel = `Atualizado às ${formatSyncTime(lastSyncAt)}`;
  const hasFetchError = Boolean(fetchError?.trim());

  if (
    hasFetchError &&
    ageMs > DASHBOARD_STALE_POLL_MS
  ) {
    return {
      level: "stale",
      statusClass: "disconnected",
      label: `${timeLabel} · dados desatualizados`,
    };
  }

  if (wsConnected && ageMs <= DASHBOARD_STALE_LIVE_MS) {
    return {
      level: "live",
      statusClass: "connected",
      label: timeLabel,
    };
  }

  if (!wsConnected && ageMs <= DASHBOARD_STALE_POLL_MS) {
    return {
      level: "degraded",
      statusClass: "degraded",
      label: timeLabel,
    };
  }

  return {
    level: "stale",
    statusClass: "disconnected",
    label: `${timeLabel} · dados desatualizados`,
  };
}

export function useDashboardFreshness(
  options: Omit<UseDashboardFreshnessOptions, "now">,
): DashboardFreshness {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, DASHBOARD_FRESHNESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return computeDashboardFreshness({ ...options, now });
}
