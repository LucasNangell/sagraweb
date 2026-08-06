import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchAndamentos } from "@/api/pcp";
import { fetchSetores } from "@/api/aux";
import { useAuthStore } from "@/features/auth/authStore";
import { useOsFiltersStore } from "@/features/os/osFiltersStore";
import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

import { fetchPainelBoardData, fetchRemotePainelConfig } from "../painelGlobalApi";
import {
  normalizePainelConfig,
  PAINEL_CONFIG_STORAGE_KEY,
  usePainelConfigStore,
} from "../painelConfigStore";
import { triggerPainelPriorityAlert } from "./usePainelAlert";
import {
  buildAllOpsList,
  filterPainelRawByOsSp,
  processPainelData,
  sortColumnItems,
} from "../painelGlobalUtils";
import type { PainelRawOp } from "../types";
import type {
  PainelColumnDetail,
  PainelColumnDisplay,
  PainelConfig,
  PainelOpItem,
  PainelTheme,
} from "../types";

interface PainelWsMessage {
  type?: string;
  overwriteConfig?: boolean;
}

const POLL_MS = 300_000;
const WS_FETCH_DEBOUNCE_MS = 500;

export function usePainelGlobalData() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const config = usePainelConfigStore((s) => s.config);
  const setConfig = usePainelConfigStore((s) => s.setConfig);
  const patchColumnMute = usePainelConfigStore((s) => s.patchColumnMute);
  const resetConfig = usePainelConfigStore((s) => s.resetConfig);

  useUserPreferenceSync({
    key: "painel_global",
    enabled: isAuthenticated,
    watchValue: config,
    onRemoteLoaded: (remote) => {
      setConfig(normalizePainelConfig(remote as Partial<PainelConfig>));
    },
  });

  const includeOs = useOsFiltersStore((s) => s.filters.includeOs);
  const includeSp = useOsFiltersStore((s) => s.filters.includeSp);
  const patchOsFilters = useOsFiltersStore((s) => s.patchFilters);

  const masterOpsMapRef = useRef(new Map<string, PainelOpItem>());
  const rawBoardDataRef = useRef<PainelRawOp[]>([]);

  const [columns, setColumns] = useState<PainelColumnDisplay[]>([]);
  const [allOpsList, setAllOpsList] = useState<PainelOpItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState("Carregando dados");
  const [isConnected, setIsConnected] = useState(false);
  const [setoresList, setSetoresList] = useState<string[]>([]);
  const [andamentosList, setAndamentosList] = useState<string[]>([]);
  const [showExpCorrespondencia, setShowExpCorrespondencia] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [expandedOpKey, setExpandedOpKey] = useState<string | null>(null);
  const [selectedColumnDetail, setSelectedColumnDetail] =
    useState<PainelColumnDetail | null>(null);
  const [theme, setTheme] = useState<PainelTheme>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" ? "light" : "dark";
  });

  useUserPreferenceSync({
    key: "painel_theme",
    enabled: isAuthenticated,
    watchValue: theme,
    onRemoteLoaded: (remote) => {
      const next =
        remote === "light" || remote === "dark" ? remote : "dark";
      setTheme(next);
    },
  });

  const configRef = useRef(config);
  configRef.current = config;

  const configSignature = useMemo(
    () =>
      JSON.stringify({
        columnCount: config.columnCount,
        columns: config.columns.map((c) => ({
          id: c.id,
          title: c.title,
          sectors: c.sectors,
          statuses: c.statuses,
        })),
      }),
    [config],
  );

  const showExpRef = useRef(showExpCorrespondencia);
  showExpRef.current = showExpCorrespondencia;

  const includeOsRef = useRef(includeOs);
  includeOsRef.current = includeOs;
  const includeSpRef = useRef(includeSp);
  includeSpRef.current = includeSp;

  const applyProcessedData = useCallback(
    (processed: ReturnType<typeof processPainelData>) => {
      const sorted = sortColumnItems(processed.columns);
      setColumns(sorted);
      setAllOpsList(
        buildAllOpsList(masterOpsMapRef.current, showExpRef.current),
      );
      if (processed.hasNewPriorityAlert) {
        void triggerPainelPriorityAlert();
      }
    },
    [],
  );

  const fetchData = useCallback(async () => {
    const currentConfig = configRef.current;
    const uniqueSectors = Array.from(
      new Set(currentConfig.columns.flatMap((c) => c.sectors ?? []).filter(Boolean)),
    );

    try {
      const rawData = await fetchPainelBoardData(uniqueSectors);
      rawBoardDataRef.current = rawData;
      const filteredRaw = filterPainelRawByOsSp(
        rawData,
        includeOsRef.current,
        includeSpRef.current,
      );
      const processed = processPainelData(
        filteredRaw,
        currentConfig.columns,
        masterOpsMapRef.current,
      );
      applyProcessedData(processed);
      setIsConnected(true);
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
    } catch (err) {
      console.error("[Painel] Falha ao atualizar dados", err);
      setIsConnected(false);
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
    }
  }, [applyProcessedData]);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;

  const wsFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFetchFromWs = useCallback(() => {
    if (wsFetchTimerRef.current != null) {
      clearTimeout(wsFetchTimerRef.current);
    }
    wsFetchTimerRef.current = setTimeout(() => {
      wsFetchTimerRef.current = null;
      if (!document.hidden) {
        void fetchDataRef.current();
      }
    }, WS_FETCH_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (wsFetchTimerRef.current != null) {
        clearTimeout(wsFetchTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchSetores().then(setSetoresList);
    void fetchAndamentos().then(setAndamentosList);
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    setColumns(
      config.columns.map((c) => ({
        ...c,
        items: [],
      })),
    );
    masterOpsMapRef.current.clear();
    void fetchDataRef.current();
  }, [configSignature]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (!document.hidden) {
        void fetchDataRef.current();
      }
    }, POLL_MS);
    return () => window.clearInterval(pollId);
  }, []);

  useEffect(() => {
    setListLoading(true);
    const timer = window.setTimeout(() => {
      setAllOpsList(
        buildAllOpsList(masterOpsMapRef.current, showExpCorrespondencia),
      );
      setListLoading(false);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [showExpCorrespondencia]);

  const reprocessBoardData = useCallback(() => {
    const filteredRaw = filterPainelRawByOsSp(
      rawBoardDataRef.current,
      includeOsRef.current,
      includeSpRef.current,
    );
    const processed = processPainelData(
      filteredRaw,
      configRef.current.columns,
      masterOpsMapRef.current,
    );
    applyProcessedData(processed);
    setSelectedColumnDetail((prev) => {
      if (!prev) {
        return null;
      }
      const match = processed.columns.find((col) => col.title === prev.title);
      return match ? { title: match.title, items: match.items } : null;
    });
  }, [applyProcessedData]);

  useEffect(() => {
    if (rawBoardDataRef.current.length === 0) {
      return;
    }
    reprocessBoardData();
  }, [includeOs, includeSp, reprocessBoardData]);

  const handleForceRefresh = useCallback(async (overwriteConfig?: boolean) => {
    if (overwriteConfig) {
      try {
        const globalConfig = await fetchRemotePainelConfig();
        localStorage.setItem(
          PAINEL_CONFIG_STORAGE_KEY,
          JSON.stringify(globalConfig),
        );
        usePainelConfigStore.setState({
          config: normalizePainelConfig(
            globalConfig as Partial<PainelConfig>,
          ),
        });
      } catch (err) {
        console.error("[WebSocket] Falha ao baixar config global:", err);
      }
    }
    window.location.reload();
  }, []);

  useSagraWebSocket<PainelWsMessage>({
    path: "/ws",
    onMessage: (data) => {
      if (data.type === "force_refresh") {
        void handleForceRefresh(data.overwriteConfig);
        return;
      }
      if (data.type === "system_update" || data.type === "pcp_queue_update") {
        scheduleFetchFromWs();
      }
    },
  });

  const connectionStatusText =
    lastUpdated === "Carregando dados"
      ? "Carregando dados"
      : `Atualizado às ${lastUpdated}`;

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleExpand = useCallback((os: PainelOpItem) => {
    setExpandedOpKey((prev) => (prev === os.uniqueKey ? null : os.uniqueKey));
  }, []);

  const toggleMute = useCallback(
    (colIdx: number, muted: boolean) => {
      patchColumnMute(colIdx, muted);
      setColumns((prev) =>
        prev.map((col, idx) =>
          idx === colIdx ? { ...col, muted } : col,
        ),
      );
    },
    [patchColumnMute],
  );

  const showColumnDetail = useCallback((col: PainelColumnDisplay) => {
    setSelectedColumnDetail({ title: col.title, items: col.items });
  }, []);

  const closeColumnDetail = useCallback(() => {
    setSelectedColumnDetail(null);
  }, []);

  const handleSaveSettings = useCallback(
    (next: PainelConfig) => {
      setConfig(next);
      masterOpsMapRef.current.clear();
      setSelectedColumnDetail(null);
      void fetchDataRef.current();
    },
    [setConfig],
  );

  const handleClearCache = useCallback(() => {
    localStorage.removeItem(PAINEL_CONFIG_STORAGE_KEY);
    resetConfig();
    masterOpsMapRef.current.clear();
    setSelectedColumnDetail(null);
    void fetchDataRef.current();
  }, [resetConfig]);

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => currentYear - i);
  }, []);

  return {
    config,
    columns,
    allOpsList,
    isConnected,
    connectionStatusText,
    setoresList,
    andamentosList,
    showExpCorrespondencia,
    setShowExpCorrespondencia,
    includeOs,
    includeSp,
    patchOsFilters,
    listLoading,
    expandedOpKey,
    toggleExpand,
    selectedColumnDetail,
    showColumnDetail,
    closeColumnDetail,
    theme,
    toggleTheme,
    toggleMute,
    handleSaveSettings,
    handleClearCache,
    availableYears,
    fetchData,
  };
}
