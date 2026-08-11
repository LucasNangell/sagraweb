import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchAndamentos } from "@/api/pcp";
import { fetchSetores } from "@/api/auxLookups";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import { fetchDashboardSectorData } from "../api";
import {
  applyOsPatchToItemsMap,
  fetchDashboardItemsForOsEvent,
  mergePcpOrderFromQueue,
  osUpdateKey,
  parseOsUpdateKey,
  shouldFetchSubOsForEvent,
} from "../dashboardRealtimeSync";
import {
  DASHBOARD_NEW_HIGHLIGHT_MS,
  DASHBOARD_POLL_INTERVAL_MS,
  DASHBOARD_WS_DOWN_POLL_BASE_MS,
  DASHBOARD_WS_DOWN_POLL_MAX_MS,
  DASHBOARD_WS_FETCH_DEBOUNCE_MS,
} from "../constants";
import {
  buildDashboardConfigSignature,
  collectDashboardSectors,
  dashboardItemKey,
  emptyDisplayColumns,
  hashDashboardBoard,
  hashDashboardItems,
  processDashboardData,
  refreshDashboardHighlights,
} from "../utils";
import type {
  DashboardConfig,
  DashboardDisplayColumn,
  DashboardOsItem,
  DashboardWsMessage,
} from "../types";
import type { PcpQueueItem } from "@/api/pcp";

export type DashboardConnectionStatus = "connected" | "disconnected";

interface UseDashboardSetorDataOptions {
  config: DashboardConfig;
  onNewItems?: () => void;
}

function wsEventAffectsSectors(
  data: DashboardWsMessage,
  sectors: string[],
): boolean {
  const eventSetor = (data.setor ?? "").trim();
  if (!eventSetor) {
    return true;
  }
  for (const sector of sectors) {
    const cfg = sector.trim();
    if (!cfg) {
      continue;
    }
    if (eventSetor === cfg) {
      return true;
    }
    if (cfg === "Gravação" && eventSetor === "SEFOC") {
      return true;
    }
  }
  return false;
}

function toOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function syncItemsMapFromList(
  itemsMap: Map<string, PcpQueueItem>,
  items: PcpQueueItem[],
): void {
  itemsMap.clear();
  for (const item of items) {
    itemsMap.set(dashboardItemKey(item), item);
  }
}

export function useDashboardSetorData({
  config,
  onNewItems,
}: UseDashboardSetorDataOptions) {
  const [columns, setColumns] = useState<DashboardDisplayColumn[]>(() =>
    emptyDisplayColumns(config),
  );
  const [lastUpdated, setLastUpdated] = useState("Carregando dados");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [setoresList, setSetoresList] = useState<string[]>([]);
  const [andamentosList, setAndamentosList] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const masterOpsMapRef = useRef<Map<string, DashboardOsItem>>(new Map());
  const itemsMapRef = useRef<Map<string, PcpQueueItem>>(new Map());
  const boardSignatureRef = useRef("");
  const rawItemsSignatureRef = useRef("");
  const fetchGenerationRef = useRef(0);
  const isFetchingRef = useRef(false);
  const isPatchingRef = useRef(false);
  const pendingFetchRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const onNewItemsRef = useRef(onNewItems);
  onNewItemsRef.current = onNewItems;
  const configRef = useRef(config);
  configRef.current = config;

  const configSignature = useMemo(
    () => buildDashboardConfigSignature(config),
    [config],
  );

  const markSynced = useCallback(() => {
    const now = Date.now();
    setLastSyncAt(now);
    setLastUpdated(new Date(now).toLocaleTimeString("pt-BR"));
  }, []);

  const publishBoard = useCallback(
    (
      processed: ReturnType<typeof processDashboardData>,
      options?: { touchUpdatedAt?: boolean; partial?: boolean },
    ) => {
      const nextSignature = hashDashboardBoard(processed.columns);
      if (nextSignature === boardSignatureRef.current) {
        return false;
      }

      boardSignatureRef.current = nextSignature;

      if (processed.hasNewItems && hasLoadedOnceRef.current) {
        onNewItemsRef.current?.();
      }

      setColumns(processed.columns);
      if (options?.touchUpdatedAt !== false) {
        setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
      }
      setHasLoadedOnce(true);
      hasLoadedOnceRef.current = true;
      setFetchError(null);
      return true;
    },
    [],
  );

  const reprocessFromItemsMap = useCallback(
    (options?: {
      isInitialLoad?: boolean;
      touchUpdatedAt?: boolean;
      partial?: boolean;
    }) => {
      const processed = processDashboardData(
        [...itemsMapRef.current.values()],
        configRef.current,
        masterOpsMapRef.current,
        {
          isInitialLoad: options?.isInitialLoad === true,
        },
      );
      return publishBoard(processed, options);
    },
    [publishBoard],
  );

  const applyRawItems = useCallback(
    (
      raw: PcpQueueItem[],
      options?: {
        isInitialLoad?: boolean;
        touchUpdatedAt?: boolean;
        partial?: boolean;
      },
    ) => {
      const nextRawSignature = hashDashboardItems(raw);
      if (
        nextRawSignature === rawItemsSignatureRef.current &&
        !options?.isInitialLoad
      ) {
        return false;
      }
      rawItemsSignatureRef.current = nextRawSignature;
      syncItemsMapFromList(itemsMapRef.current, raw);
      return reprocessFromItemsMap(options);
    },
    [reprocessFromItemsMap],
  );

  const fetchData = useCallback(
    async (options?: { isInitialLoad?: boolean }) => {
      if (isFetchingRef.current) {
        pendingFetchRef.current = true;
        return;
      }
      isFetchingRef.current = true;

      const generation = ++fetchGenerationRef.current;
      const isInitialLoad =
        options?.isInitialLoad === true || !hasLoadedOnceRef.current;

      if (isInitialLoad) {
        setIsFetching(true);
        setFetchError(null);
      }

      try {
        const sectors = collectDashboardSectors(configRef.current);
        const raw = await fetchDashboardSectorData(
          sectors,
          isInitialLoad
            ? (partialItems) => {
                if (generation !== fetchGenerationRef.current) {
                  return;
                }
                applyRawItems(partialItems, {
                  isInitialLoad: true,
                  partial: true,
                });
              }
            : undefined,
        );
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        const partial = !isInitialLoad;
        setFetchError(null);
        applyRawItems(raw, {
          isInitialLoad,
          partial,
          touchUpdatedAt: true,
        });
        markSynced();
        setHasLoadedOnce(true);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        console.error("[DashboardSetor] Falha ao carregar dados:", err);
        const errMsg =
          err instanceof Error ? err.message : "Falha ao carregar o painel";
        setFetchError(errMsg);
      } finally {
        isFetchingRef.current = false;
        setIsFetching(false);
        if (pendingFetchRef.current) {
          pendingFetchRef.current = false;
          void fetchData();
        }
      }
    },
    [applyRawItems, markSynced],
  );

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  const resetDataState = useCallback(() => {
    masterOpsMapRef.current.clear();
    itemsMapRef.current.clear();
    boardSignatureRef.current = "";
    rawItemsSignatureRef.current = "";
    setColumns(emptyDisplayColumns(configRef.current));
    setLastUpdated("Carregando dados");
    setLastSyncAt(null);
    setHasLoadedOnce(false);
    hasLoadedOnceRef.current = false;
  }, []);

  const pendingOsUpdatesRef = useRef<Map<string, DashboardWsMessage>>(
    new Map(),
  );
  const pendingPcpMergeRef = useRef(false);
  const wsPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousWsStatusRef = useRef<string | null>(null);
  const wsEverConnectedRef = useRef(false);

  const flushWsPatch = useCallback(async () => {
    if (isPatchingRef.current) {
      pendingFetchRef.current = true;
      return;
    }

    const osUpdates = new Map(pendingOsUpdatesRef.current);
    const needsPcpMerge = pendingPcpMergeRef.current;
    pendingOsUpdatesRef.current.clear();
    pendingPcpMergeRef.current = false;

    if (osUpdates.size === 0 && !needsPcpMerge) {
      return;
    }

    if (!hasLoadedOnceRef.current && itemsMapRef.current.size === 0) {
      void fetchDataRef.current({ isInitialLoad: true });
      return;
    }

    isPatchingRef.current = true;
    const generation = fetchGenerationRef.current;
    const sectors = collectDashboardSectors(configRef.current);
    let changed = false;

    try {
      if (osUpdates.size > 0) {
        for (const [key, message] of osUpdates) {
          const parsed = parseOsUpdateKey(key);
          if (!parsed) {
            continue;
          }
          const includeSubOs = shouldFetchSubOsForEvent(message);
          const subOsId = toOptionalNumber(message.sub_os_id);
          const incoming = await fetchDashboardItemsForOsEvent(
            sectors,
            parsed.nrOs,
            parsed.ano,
            {
              includeSubOs,
              subOsId,
            },
          );
          if (generation !== fetchGenerationRef.current) {
            return;
          }

          const patchResult = applyOsPatchToItemsMap(
            itemsMapRef.current,
            sectors,
            parsed.nrOs,
            parsed.ano,
            incoming,
            includeSubOs && subOsId != null ? { subOsId } : undefined,
          );
          itemsMapRef.current = patchResult.map;
          changed = changed || patchResult.changed;
        }
      }

      if (needsPcpMerge) {
        const mergeResult = await mergePcpOrderFromQueue(
          itemsMapRef.current,
          sectors,
        );
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        itemsMapRef.current = mergeResult.map;
        changed = changed || mergeResult.changed;
      }

      if (changed) {
        rawItemsSignatureRef.current = hashDashboardItems(
          itemsMapRef.current.values(),
        );
        reprocessFromItemsMap({ partial: true, touchUpdatedAt: true });
      }
      markSynced();
    } catch (err) {
      console.warn(
        "[DashboardSetor] Patch incremental falhou — refetch completo:",
        err,
      );
      void fetchDataRef.current();
    } finally {
      isPatchingRef.current = false;
      if (pendingFetchRef.current) {
        pendingFetchRef.current = false;
        void flushWsPatch();
      }
    }
  }, [markSynced, reprocessFromItemsMap]);

  const flushWsPatchRef = useRef(flushWsPatch);
  flushWsPatchRef.current = flushWsPatch;

  const scheduleWsPatch = useCallback((message?: DashboardWsMessage) => {
    if (message) {
      const nrOs = toOptionalNumber(message.id);
      const ano = toOptionalNumber(message.ano);
      if (nrOs != null && ano != null) {
        pendingOsUpdatesRef.current.set(osUpdateKey(nrOs, ano), message);
      } else {
        pendingPcpMergeRef.current = true;
      }
    } else {
      pendingPcpMergeRef.current = true;
    }

    if (wsPatchTimerRef.current != null) {
      clearTimeout(wsPatchTimerRef.current);
    }
    wsPatchTimerRef.current = setTimeout(() => {
      wsPatchTimerRef.current = null;
      void flushWsPatchRef.current();
    }, DASHBOARD_WS_FETCH_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (wsPatchTimerRef.current != null) {
        clearTimeout(wsPatchTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (refreshDashboardHighlights(masterOpsMapRef.current)) {
        reprocessFromItemsMap({ partial: true, touchUpdatedAt: false });
      }
    }, Math.min(DASHBOARD_NEW_HIGHLIGHT_MS, 5_000));
    return () => window.clearInterval(timer);
  }, [reprocessFromItemsMap]);

  const {
    status: wsStatus,
    lastError: wsLastError,
    reconnectAttempt: wsReconnectAttempt,
    reconnect: wsReconnect,
  } = useSagraWebSocket<DashboardWsMessage>({
    path: "/ws",
    onMessage: (data) => {
      if (data.type === "force_refresh") {
        void fetchDataRef.current();
        return;
      }

      if (data.type === "system_update" || data.type === "pcp_queue_update") {
        if (
          !wsEventAffectsSectors(
            data,
            collectDashboardSectors(configRef.current),
          )
        ) {
          return;
        }
        if (data.type === "pcp_queue_update") {
          scheduleWsPatch();
          return;
        }
        scheduleWsPatch(data);
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
      if (cancelled) {
        return;
      }
      window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        void fetchDataRef.current();
        delayMs = Math.min(
          Math.round(delayMs * 1.5),
          DASHBOARD_WS_DOWN_POLL_MAX_MS,
        );
        schedule();
      }, delayMs);
    };

    schedule();
    return () => {
      cancelled = true;
    };
  }, [wsStatus]);

  useEffect(() => {
    void fetchSetores()
      .then(setSetoresList)
      .catch((err) => console.error("[DashboardSetor] setores:", err));
    void fetchAndamentos()
      .then(setAndamentosList)
      .catch((err) => console.error("[DashboardSetor] andamentos:", err));
  }, []);

  useEffect(() => {
    masterOpsMapRef.current.clear();
    itemsMapRef.current.clear();
    boardSignatureRef.current = "";
    rawItemsSignatureRef.current = "";
    setColumns(emptyDisplayColumns(configRef.current));
    setLastUpdated("Carregando dados");
    setLastSyncAt(null);
    setHasLoadedOnce(false);
    hasLoadedOnceRef.current = false;
    void fetchDataRef.current({ isInitialLoad: true });
  }, [configSignature]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || wsStatus !== "connected") {
        return;
      }
      void fetchDataRef.current();
    }, DASHBOARD_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [wsStatus]);

  const connectionStatus: DashboardConnectionStatus =
    wsStatus === "connected" ? "connected" : "disconnected";

  return {
    columns,
    lastUpdated,
    lastSyncAt,
    connectionStatus,
    setoresList,
    andamentosList,
    isFetching,
    fetchError,
    fetchData,
    resetDataState,
    wsStatus,
    wsLastError,
    wsReconnectAttempt,
    wsReconnect,
    hasLoadedOnce,
  };
};
