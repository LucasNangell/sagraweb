import { useCallback, useEffect, useRef, useState } from "react";

import { useSagraWebSocket } from "@/lib/ws";

import { fetchDashboardOsByKey, fetchDashboardQueue } from "./api";
import {
  DASHBOARD_POLL_INTERVAL_MS,
  DASHBOARD_WS_DOWN_POLL_BASE_MS,
  DASHBOARD_WS_DOWN_POLL_MAX_MS,
  DASHBOARD_WS_FETCH_DEBOUNCE_MS,
} from "./constants";
import type {
  DashboardConfig,
  DashboardDisplayColumn,
  DashboardOsItem,
  DashboardWsMessage,
} from "./types";
import {
  processDashboardData,
  refreshDashboardHighlights,
} from "./utils";

export function useBoardData(config: DashboardConfig) {
  const [columns, setColumns] = useState<DashboardDisplayColumn[]>(() =>
    config.columns.map((c) => ({ ...c, items: [] })),
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const masterMapRef = useRef(new Map<string, DashboardOsItem>());
  const configRef = useRef(config);
  configRef.current = config;
  const debounceRef = useRef<number | null>(null);
  const pollBackoffRef = useRef(DASHBOARD_WS_DOWN_POLL_BASE_MS);
  const initialRef = useRef(true);

  const applyItems = useCallback((items: import("./types").PcpQueueItem[]) => {
    const result = processDashboardData(
      items,
      configRef.current,
      masterMapRef.current,
      { isInitialLoad: initialRef.current },
    );
    initialRef.current = false;
    setColumns(result.columns);
    setLastUpdated(new Date());
    setHasLoadedOnce(true);
    setLoading(false);
    setError(null);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const items = await fetchDashboardQueue(configRef.current.sector);
      applyItems(items);
      pollBackoffRef.current = DASHBOARD_WS_DOWN_POLL_BASE_MS;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar fila");
      setLoading(false);
    }
  }, [applyItems]);

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void fetchData();
    }, DASHBOARD_WS_FETCH_DEBOUNCE_MS);
  }, [fetchData]);

  const onWsMessage = useCallback(
    (raw: unknown) => {
      const msg = raw as DashboardWsMessage;
      const type = msg.type;
      if (type === "force_refresh") {
        scheduleFetch();
        return;
      }
      if (type === "system_update" || type === "pcp_queue_update") {
        const setor = msg.setor?.trim();
        if (setor && setor !== configRef.current.sector) return;
        if (msg.id != null && msg.ano != null) {
          void (async () => {
            try {
              const item = await fetchDashboardOsByKey(msg.id!, msg.ano!);
              if (!item) {
                scheduleFetch();
                return;
              }
              const key = `${item.nr_os}-${item.ano}`;
              // Full refresh keeps board consistent for Sub OS / PCP order
              scheduleFetch();
              void key;
            } catch {
              scheduleFetch();
            }
          })();
        } else {
          scheduleFetch();
        }
      }
    },
    [scheduleFetch],
  );

  const { status: wsStatus } = useSagraWebSocket({
    enabled: true,
    onMessage: onWsMessage,
  });

  // Reset when sector/columns change
  useEffect(() => {
    masterMapRef.current = new Map();
    initialRef.current = true;
    setLoading(true);
    setColumns(config.columns.map((c) => ({ ...c, items: [] })));
    void fetchData();
  }, [config.sector, config.columnCount, fetchData]);

  // Polling
  useEffect(() => {
    let timer: number | null = null;
    const tick = () => {
      const connected = wsStatus === "connected";
      const delay = connected
        ? DASHBOARD_POLL_INTERVAL_MS
        : pollBackoffRef.current;
      timer = window.setTimeout(() => {
        void fetchData().finally(() => {
          if (!connected) {
            pollBackoffRef.current = Math.min(
              DASHBOARD_WS_DOWN_POLL_MAX_MS,
              Math.round(pollBackoffRef.current * 1.5),
            );
          }
          tick();
        });
      }, delay);
    };
    tick();
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [fetchData, wsStatus]);

  // Expire green highlights
  useEffect(() => {
    const id = window.setInterval(() => {
      if (refreshDashboardHighlights(masterMapRef.current)) {
        setColumns((prev) =>
          prev.map((col) => ({
            ...col,
            items: col.items.map((item) => ({ ...item })),
          })),
        );
      }
    }, 5_000);
    return () => window.clearInterval(id);
  }, []);

  return {
    columns,
    lastUpdated,
    loading,
    error,
    hasLoadedOnce,
    connectionStatus: wsStatus,
    fetchData,
  };
}
