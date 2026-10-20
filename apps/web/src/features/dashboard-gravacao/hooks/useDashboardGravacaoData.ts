import { useCallback, useEffect, useRef, useState } from "react";

import { isAdminForceReload } from "@/features/realtime/adminForceRefresh";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import {
  DASHBOARD_POLL_INTERVAL_MS,
  DASHBOARD_WS_DOWN_POLL_BASE_MS,
  DASHBOARD_WS_DOWN_POLL_MAX_MS,
  DASHBOARD_WS_FETCH_DEBOUNCE_MS,
} from "@/features/dashboard-setor/constants";

import { fetchPainelGravacaoBoard } from "../api";
import { GRAVACAO_WS_TYPES } from "../constants";
import { toDisplayColumns } from "../groupCards";
import type { GravacaoDisplayColumn } from "../types";

export function useDashboardGravacaoData() {
  const [columns, setColumns] = useState<GravacaoDisplayColumn[]>(() =>
    toDisplayColumns(null),
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const fetchGenerationRef = useRef(0);
  const isFetchingRef = useRef(false);
  const pendingFetchRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousWsStatusRef = useRef<string | null>(null);
  const wsEverConnectedRef = useRef(false);

  const fetchData = useCallback(async (options?: { isInitialLoad?: boolean }) => {
    if (isFetchingRef.current) {
      pendingFetchRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    const generation = ++fetchGenerationRef.current;
    const isInitialLoad = options?.isInitialLoad === true;
    if (isInitialLoad) {
      setIsFetching(true);
      setFetchError(null);
    }
    try {
      const board = await fetchPainelGravacaoBoard();
      if (generation !== fetchGenerationRef.current) {
        return;
      }
      setColumns(toDisplayColumns(board));
      setLastSyncAt(Date.now());
      setFetchError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (generation !== fetchGenerationRef.current) {
        return;
      }
      const message =
        err instanceof Error ? err.message : "Falha ao carregar o painel";
      setFetchError(message);
    } finally {
      isFetchingRef.current = false;
      setIsFetching(false);
      if (pendingFetchRef.current) {
        pendingFetchRef.current = false;
        void fetchData();
      }
    }
  }, []);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchDataRef.current();
    }, DASHBOARD_WS_FETCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  const {
    status: wsStatus,
    lastError: wsLastError,
    reconnectAttempt: wsReconnectAttempt,
  } = useSagraWebSocket<{ type?: string }>({
    path: "/ws",
    onMessage: (data) => {
      const type = data?.type ?? "";
      if (type === "force_refresh" && isAdminForceReload(data)) {
        return;
      }
      if (GRAVACAO_WS_TYPES.has(type)) {
        scheduleFetch();
      }
    },
  });

  useEffect(() => {
    const previous = previousWsStatusRef.current;
    previousWsStatusRef.current = wsStatus;
    if (wsStatus === "connected") {
      if (wsEverConnectedRef.current && previous && previous !== "connected") {
        void fetchDataRef.current();
      }
      wsEverConnectedRef.current = true;
    }
  }, [wsStatus]);

  useEffect(() => {
    if (wsStatus === "connected") {
      return;
    }
    let cancelled = false;
    let delayMs = DASHBOARD_WS_DOWN_POLL_BASE_MS;
    const schedule = () => {
      if (cancelled) return;
      window.setTimeout(() => {
        if (cancelled) return;
        void fetchDataRef.current();
        delayMs = Math.min(Math.round(delayMs * 1.5), DASHBOARD_WS_DOWN_POLL_MAX_MS);
        schedule();
      }, delayMs);
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, [wsStatus]);

  useEffect(() => {
    void fetchDataRef.current({ isInitialLoad: true });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || wsStatus !== "connected") {
        return;
      }
      void fetchDataRef.current();
    }, DASHBOARD_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [wsStatus]);

  return {
    columns,
    lastSyncAt,
    hasLoadedOnce,
    fetchError,
    isFetching,
    fetchData,
    wsStatus,
    wsLastError,
    wsReconnectAttempt,
  };
}
