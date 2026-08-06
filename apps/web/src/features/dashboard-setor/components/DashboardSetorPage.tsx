import { Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";

import { useAuthStore } from "@/features/auth/authStore";

import {
  clearDashboardConfigCache,
  loadDashboardConfig,
  saveDashboardConfig,
} from "../configStorage";
import { DEFAULT_DASHBOARD_CONFIG } from "../constants";
import { normalizeDashboardConfigFromRemote } from "../normalizeConfig";
import { useDashboardFreshness } from "../hooks/useDashboardFreshness";
import { useDashboardSetorData } from "../hooks/useDashboardSetorData";
import { usePriorityAlert } from "../hooks/usePriorityAlert";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { buildDashboardConfigSignature, formatQueueDisplayLabel } from "../utils";
import type { DashboardConfig } from "../types";
import { DashboardSetorSettingsModal } from "./DashboardSetorSettingsModal";
import "../dashboard-setor.css";

const COLUMN_HEADER_CLASSES = [
  "column-header-first",
  "column-header-second",
  "column-header-third",
  "column-header-fourth",
  "column-header-fifth",
] as const;

function footerLabel(count: number): string {
  if (count === 0) {
    return "";
  }
  return `${count} ${count === 1 ? "OP" : "OPs"}`;
}

export function DashboardSetorPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userSetor = useAuthStore((s) => s.user?.setor);
  const [config, setConfig] = useState<DashboardConfig>(() => {
    const local = loadDashboardConfig();
    if (userSetor && local.sector === DEFAULT_DASHBOARD_CONFIG.sector) {
      return { ...local, sector: userSetor };
    }
    return local;
  });
  const [showSettings, setShowSettings] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  useUserPreferenceSync({
    key: "painel_setor",
    enabled: isAuthenticated,
    watchValue: config,
    onRemoteLoaded: (remote) => {
      const normalized = normalizeDashboardConfigFromRemote(remote, userSetor);
      if (
        buildDashboardConfigSignature(normalized) ===
        buildDashboardConfigSignature(configRef.current)
      ) {
        return;
      }
      saveDashboardConfig(normalized);
      setConfig(normalized);
    },
  });

  const { triggerPriorityAlert } = usePriorityAlert();

  useScreenWakeLock();

  const {
    columns,
    lastSyncAt,
    setoresList,
    andamentosList,
    fetchError,
    fetchData,
    resetDataState,
    wsStatus,
    hasLoadedOnce,
  } = useDashboardSetorData({
    config,
    onNewItems: () => {
      void triggerPriorityAlert();
    },
  });

  const freshness = useDashboardFreshness({
    hasLoadedOnce,
    lastSyncAt,
    wsStatus,
    fetchError,
  });

  const applyConfig = useCallback(
    (next: DashboardConfig) => {
      const normalized = {
        ...next,
        columnCount: next.columns.length,
      };
      saveDashboardConfig(normalized);
      setConfig(normalized);
      resetDataState();
    },
    [resetDataState],
  );

  const handleSaveSettings = (next: DashboardConfig) => {
    setShowSettings(false);
    applyConfig(next);
  };

  const handleClearCache = () => {
    clearDashboardConfigCache();
    const defaults = {
      ...DEFAULT_DASHBOARD_CONFIG,
      columnCount: DEFAULT_DASHBOARD_CONFIG.columns.length,
    };
    setShowSettings(false);
    applyConfig(defaults);
    window.alert("✅ Cache limpo! Configuração padrão restaurada.");
  };

  return (
    <div className="dashboard-setor-page">
      <header className="dashboard-setor-header">
        <div className="dashboard-setor-header-left">
          <div className="dashboard-setor-status-indicator">
            <span
              className={`dashboard-setor-connection-status ${freshness.statusClass}`}
              aria-hidden
            />
            <span>{freshness.label}</span>
          </div>
        </div>

        <div className="dashboard-setor-header-center">
          <h1>OPs na {config.sector}</h1>
        </div>

        <div className="dashboard-setor-header-right">
          <button
            type="button"
            className="dashboard-setor-settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Configurações do painel"
          >
            <Settings className="size-5" />
          </button>
        </div>
      </header>

      <main
        className="dashboard-setor-board"
        data-columns={String(config.columnCount)}
      >
        {columns.map((col, index) => (
          <div key={col.id} className="dashboard-setor-column">
            <div
              className={[
                "dashboard-setor-column-header",
                COLUMN_HEADER_CLASSES[index] ?? "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="dashboard-setor-column-title">{col.title}</span>
              {col.items.length > 0 && (
                <span className="dashboard-setor-column-count">
                  {col.items.length}
                </span>
              )}
            </div>

            <div className="dashboard-setor-column-content">
              {col.items.map((os) => (
                <div
                  key={os.uniqueKey}
                  className={[
                    "dashboard-setor-card",
                    os.isNew ? "is-new" : "",
                    os.priorityType ?? "",
                    os.row_kind === "sub_os" ? "sub-os-card" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="dashboard-setor-card-header">
                    <span className="dashboard-setor-os-number">
                      {formatQueueDisplayLabel(os)}
                    </span>
                  </div>
                  <div
                    className="dashboard-setor-os-situation"
                    title={os.displaySituacao}
                  >
                    {os.displaySituacao}
                  </div>
                </div>
              ))}
            </div>

            <div className="dashboard-setor-column-footer">
              <span className="dashboard-setor-column-footer-content">
                {footerLabel(col.items.length)}
              </span>
            </div>
          </div>
        ))}
      </main>

      <DashboardSetorSettingsModal
        open={showSettings}
        config={config}
        setoresList={setoresList}
        andamentosList={andamentosList}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
        onClearCache={handleClearCache}
      />
    </div>
  );
}
