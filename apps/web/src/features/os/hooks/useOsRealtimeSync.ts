import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { isAdminForceReload } from "@/features/realtime/adminForceRefresh";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import {
  applyOsSystemUpdate,
  silentRefreshOsSearch,
  type OsSystemUpdateMessage,
} from "../osRealtimeSync";
import { normalizeOsSearchFilters } from "../osSearchUtils";
import { useOsSelectionStore } from "../osSelectionStore";
import type { OsSearchFilters, OsSearchRow } from "../types";

interface UseOsRealtimeSyncOptions {
  filters: OsSearchFilters;
  onForceRefresh?: () => void;
}

function toOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSystemUpdate(
  data: OsSystemUpdateMessage,
): Pick<OsSystemUpdateMessage, "id" | "ano" | "action" | "setor" | "sub_os_id" | "scope"> {
  return {
    id: toOptionalNumber(data.id),
    ano: toOptionalNumber(data.ano),
    action: data.action,
    setor: data.setor,
    sub_os_id: toOptionalNumber(data.sub_os_id),
    scope: data.scope,
  };
}

export function useOsRealtimeSync({
  filters,
  onForceRefresh,
}: UseOsRealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const selected = useOsSelectionStore((s) => s.selected);
  const setSelected = useOsSelectionStore((s) => s.setSelected);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const previousWsStatusRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (pendingRefreshRef.current != null) {
        clearTimeout(pendingRefreshRef.current);
      }
    },
    [],
  );

  const immediateListRefresh = useCallback(() => {
    lastRefreshAtRef.current = Date.now();
    void silentRefreshOsSearch(
      queryClient,
      normalizeOsSearchFilters(filtersRef.current),
      { skipCrossTabLock: true },
    );
  }, [queryClient]);

  const scheduleListRefresh = useCallback(
    (debounceMs = 300) => {
      if (pendingRefreshRef.current != null) {
        clearTimeout(pendingRefreshRef.current);
      }
      if (debounceMs <= 0) {
        pendingRefreshRef.current = null;
        immediateListRefresh();
        return;
      }
      pendingRefreshRef.current = setTimeout(() => {
        pendingRefreshRef.current = null;
        immediateListRefresh();
      }, debounceMs);
    },
    [immediateListRefresh],
  );

  /** Evita stampede: no mínimo 5s entre silent refreshes do mesmo cliente. */
  const triggerSafeRefresh = useCallback(
    (minIntervalMs = 5_000) => {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < minIntervalMs) {
        return;
      }
      lastRefreshAtRef.current = now;
      void silentRefreshOsSearch(
        queryClient,
        normalizeOsSearchFilters(filtersRef.current),
        { skipCrossTabLock: true },
      );
    },
    [queryClient],
  );

  const onSelectedRowPatched = useCallback(
    (row: OsSearchRow) => {
      setSelected(row);
    },
    [setSelected],
  );

  const handleSystemUpdate = useCallback(
    async (data: ReturnType<typeof normalizeSystemUpdate>) => {
      await applyOsSystemUpdate(
        queryClient,
        filtersRef.current,
        {
          id: data.id,
          ano: data.ano,
          action: data.action,
          sub_os_id: data.sub_os_id ?? undefined,
        },
        {
          selected: selectedRef.current,
          onSelectedRowPatched,
        },
      );
    },
    [onSelectedRowPatched, queryClient],
  );

  const wsPath = ponto
    ? `/ws?ponto=${encodeURIComponent(ponto)}`
    : "/ws";

  const { status: wsStatus } = useSagraWebSocket<OsSystemUpdateMessage>({
    path: wsPath,
    enabled: true,
    onMessage: (data) => {
      if (data.type === "system_update") {
        const action = data.action ?? "";
        const materializedEvent =
          action === "materialized_refresh" ||
          action === "recalc_ultimo_status" ||
          action.startsWith("history_");
        void handleSystemUpdate(normalizeSystemUpdate(data))
          .catch((err) => {
            console.warn("[os-realtime] falha ao aplicar system_update", err);
            scheduleListRefresh(materializedEvent ? 0 : 300);
          });
        return;
      }
      if (data.type === "pcp_queue_update") {
        scheduleListRefresh(300);
        return;
      }
      if (data.type === "force_refresh") {
        if (isAdminForceReload(data)) {
          return;
        }
        scheduleListRefresh(0);
        onForceRefresh?.();
        return;
      }
    },
  });

  useEffect(() => {
    const previous = previousWsStatusRef.current;
    previousWsStatusRef.current = wsStatus;
    if (wsStatus === "connected" && previous && previous !== "connected") {
      // Reconectou: busca estado atual para cobrir eventos perdidos durante queda.
      triggerSafeRefresh(0);
    }
  }, [triggerSafeRefresh, wsStatus]);

  // Safety poll mesmo com WS conectado: cobre sync/notify silenciosos ou eventos perdidos.
  useEffect(() => {
    if (wsStatus !== "connected") {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        triggerSafeRefresh();
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [triggerSafeRefresh, wsStatus]);

  useEffect(() => {
    if (wsStatus === "connected") {
      return;
    }
    let cancelled = false;
    let delayMs = 5_000;

    const schedule = () => {
      if (cancelled) {
        return;
      }
      window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        if (!document.hidden) {
          triggerSafeRefresh();
        }
        delayMs = Math.min(Math.round(delayMs * 1.5), 15_000);
        schedule();
      }, delayMs);
    };

    schedule();
    return () => {
      cancelled = true;
    };
  }, [triggerSafeRefresh, wsStatus]);
}

export function useSilentOsSearchRefresh(filters: OsSearchFilters) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void silentRefreshOsSearch(queryClient, filters, {
      skipCrossTabLock: true,
    });
  }, [filters, queryClient]);
}
