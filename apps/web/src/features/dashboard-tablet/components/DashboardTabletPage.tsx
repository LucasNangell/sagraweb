import { ChevronDown, Bell, BellOff, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PainelOsInstallButton } from "@/components/pwa/PainelOsInstallButton";
import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";
import { useWebPush } from "@/hooks/useWebPush";
import { useAuthStore } from "@/features/auth/authStore";
import {
  canAccessPainelSetor,
  filterAllowedPainelSetores,
  hasPainelTabletAccess,
} from "@/features/auth/permissions";
import type { Permissions } from "@/features/auth/types";
import { DashboardSetorSettingsModal } from "@/features/dashboard-setor/components/DashboardSetorSettingsModal";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { useDashboardFreshness } from "@/features/dashboard-setor/hooks/useDashboardFreshness";
import { useDashboardSetorData } from "@/features/dashboard-setor/hooks/useDashboardSetorData";
import { usePriorityAlert } from "@/features/dashboard-setor/hooks/usePriorityAlert";
import { useScreenWakeLock } from "@/features/dashboard-setor/hooks/useScreenWakeLock";
import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import type {
  DashboardConfig,
  DashboardOsItem,
} from "@/features/dashboard-setor/types";
import { buildDashboardConfigSignature } from "@/features/dashboard-setor/utils";
import "@/features/dashboard-setor/dashboard-setor.css";

import {
  fetchPainelTabletPushPref,
  savePainelTabletPushPref,
} from "../api/pushPref";
import {
  clearTabletDashboardConfigCache,
  loadTabletDashboardConfig,
  saveTabletDashboardConfig,
} from "../configStorage";
import { sortPtBr } from "../constants";
import { resolveOsFornecedorBadges } from "../fornecedorBadge";
import { resolveOsCardLabel } from "../osCardLabel";
import { isRecebimentoChapasTabletCard } from "../recebimentoChapas";
import { TabletDiagnosticsPanel, isDiagQueryEnabled } from "./TabletDiagnosticsPanel";
import { TabletOsModal } from "./TabletOsModal";
import { TabletRecebimentoChapasModal } from "./TabletRecebimentoChapasModal";
import type { TabletIdentityMode } from "../identityMode";
import "../dashboard-tablet.css";

const LONG_PRESS_MS = 600;

const COLUMN_HEADER_CLASSES = [
  "column-header-first",
  "column-header-second",
  "column-header-third",
  "column-header-fourth",
  "column-header-fifth",
] as const;

function footerLabel(count: number): string {
  if (count === 0) return "";
  return `${count} ${count === 1 ? "OP" : "OPs"}`;
}

/** Setor permitido no tablet: painel_setores ou setor do perfil do usuário genérico. */
function canUseTabletSector(
  permissions: Permissions,
  setor: string,
  userSetor?: string | null,
): boolean {
  if (canAccessPainelSetor(permissions, setor)) {
    return true;
  }
  if (
    hasPainelTabletAccess(permissions) &&
    userSetor &&
    setor.trim() === userSetor.trim()
  ) {
    return true;
  }
  return false;
}

function resolveInitialTabletConfig(
  userSetor: string | null | undefined,
  permissions: Permissions,
): DashboardConfig {
  const local = loadTabletDashboardConfig();
  let sector = local.sector;
  if (userSetor && canUseTabletSector(permissions, userSetor, userSetor)) {
    sector = userSetor;
  } else if (sector && !canUseTabletSector(permissions, sector, userSetor)) {
    const allowed = filterAllowedPainelSetores(
      permissions,
      permissions.painelSetores.length > 0
        ? permissions.painelSetores
        : userSetor
          ? [userSetor]
          : [],
    );
    if (allowed[0]) {
      sector = allowed[0];
    } else if (userSetor) {
      sector = userSetor;
    }
  }
  return { ...local, sector };
}

export type { TabletIdentityMode };

interface DashboardTabletPageProps {
  /** `face` = reconhecimento facial (tablet). `session` = usuário logado (celular). */
  identityMode?: TabletIdentityMode;
}

export function DashboardTabletPage({
  identityMode = "face",
}: DashboardTabletPageProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userSetor = useAuthStore((s) => s.user?.setor);
  const permissions = useAuthStore((s) => s.permissions);

  const [config, setConfig] = useState<DashboardConfig>(() =>
    resolveInitialTabletConfig(userSetor, permissions),
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showSectorPicker, setShowSectorPicker] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(() =>
    isDiagQueryEnabled(),
  );
  const [selectedItem, setSelectedItem] = useState<DashboardOsItem | null>(null);
  const [recebimentoItem, setRecebimentoItem] =
    useState<DashboardOsItem | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const configRef = useRef(config);
  const sectorPickerRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const pushEnabledRef = useRef(false);
  configRef.current = config;
  pushEnabledRef.current = pushEnabled;

  const { requestBrowserPush } = useWebPush();

  const allowedSetores = useMemo(() => {
    const fromPerm = filterAllowedPainelSetores(
      permissions,
      permissions.painelSetores.length > 0
        ? permissions.painelSetores
        : userSetor
          ? [userSetor]
          : [],
    );
    if (fromPerm.length > 0) return fromPerm;
    if (userSetor && hasPainelTabletAccess(permissions)) return [userSetor];
    return [];
  }, [permissions, userSetor]);

  useUserPreferenceSync({
    key: "painel_tablet",
    enabled: isAuthenticated,
    watchValue: config,
    onRemoteLoaded: (remote) => {
      const normalized = normalizeDashboardConfigFromRemote(remote, userSetor);
      if (
        normalized.sector &&
        !canUseTabletSector(permissions, normalized.sector, userSetor)
      ) {
        if (userSetor && canUseTabletSector(permissions, userSetor, userSetor)) {
          normalized.sector = userSetor;
        }
      }
      if (
        buildDashboardConfigSignature(normalized) ===
        buildDashboardConfigSignature(configRef.current)
      ) {
        return;
      }
      saveTabletDashboardConfig(normalized);
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
    wsLastError,
    wsReconnectAttempt,
    wsReconnect,
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

  const settingsSetores = useMemo(() => {
    const fromPerm =
      permissions.painelSetoresLegacyAll || permissions.painelSetores.length === 0
        ? setoresList
        : setoresList.filter((s) => permissions.painelSetores.includes(s));
    return fromPerm.length > 0 ? fromPerm : allowedSetores.length > 0 ? allowedSetores : setoresList;
  }, [allowedSetores, permissions, setoresList]);

  const sectorOptions = useMemo(
    () => sortPtBr(settingsSetores.filter(Boolean)),
    [settingsSetores],
  );

  const applyConfig = useCallback(
    (next: DashboardConfig) => {
      let sector = next.sector;
      if (sector && !canUseTabletSector(permissions, sector, userSetor)) {
        if (userSetor && canUseTabletSector(permissions, userSetor, userSetor)) {
          sector = userSetor;
        }
      }
      const normalized = {
        ...next,
        sector,
        columnCount: next.columns.length,
      };
      saveTabletDashboardConfig(normalized);
      setConfig(normalized);
      resetDataState();
    },
    [permissions, resetDataState, userSetor],
  );

  const handleSaveSettings = (next: DashboardConfig) => {
    setShowSettings(false);
    applyConfig(next);
  };

  const handleSelectSector = useCallback(
    (sector: string) => {
      setShowSectorPicker(false);
      if (sector === configRef.current.sector) return;
      applyConfig({ ...configRef.current, sector });
    },
    [applyConfig],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setPushEnabled(false);
      return;
    }
    let cancelled = false;
    void fetchPainelTabletPushPref()
      .then((pref) => {
        if (!cancelled) {
          setPushEnabled(Boolean(pref.enabled));
        }
      })
      .catch((err) => {
        console.warn("[PainelTablet] push-pref:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !pushEnabled) {
      return;
    }
    const sector = config.sector;
    if (!sector) {
      return;
    }
    void savePainelTabletPushPref({ enabled: true, setor: sector }).catch(
      (err) => {
        console.warn("[PainelTablet] sync setor push-pref:", err);
      },
    );
  }, [config.sector, isAuthenticated, pushEnabled]);

  const handleTogglePush = useCallback(async () => {
    if (pushBusy || !isAuthenticated) {
      return;
    }
    setPushBusy(true);
    try {
      if (pushEnabledRef.current) {
        const pref = await savePainelTabletPushPref({
          enabled: false,
          setor: configRef.current.sector,
        });
        setPushEnabled(Boolean(pref.enabled));
        return;
      }
      const ok = await requestBrowserPush();
      if (!ok) {
        setPushEnabled(false);
        return;
      }
      const pref = await savePainelTabletPushPref({
        enabled: true,
        setor: configRef.current.sector,
      });
      setPushEnabled(Boolean(pref.enabled));
    } catch (err) {
      console.error("[PainelTablet] toggle push:", err);
      window.alert(
        err instanceof Error
          ? err.message
          : "Não foi possível alterar as notificações.",
      );
    } finally {
      setPushBusy(false);
    }
  }, [isAuthenticated, pushBusy, requestBrowserPush]);

  useEffect(() => {
    if (!showSectorPicker) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = sectorPickerRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setShowSectorPicker(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSectorPicker(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showSectorPicker]);

  const handleClearCache = () => {
    clearTabletDashboardConfigCache();
    const defaults = {
      ...DEFAULT_DASHBOARD_CONFIG,
      sector:
        userSetor && canUseTabletSector(permissions, userSetor, userSetor)
          ? userSetor
          : DEFAULT_DASHBOARD_CONFIG.sector,
      columnCount: DEFAULT_DASHBOARD_CONFIG.columns.length,
    };
    setShowSettings(false);
    applyConfig(defaults);
    window.alert("Cache limpo! Configuração padrão restaurada.");
  };

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(() => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      setShowDiagnostics(true);
    }, LONG_PRESS_MS);
  }, [clearLongPress]);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  return (
    <div className="dashboard-setor-page dashboard-tablet-page">
      <header className="dashboard-setor-header">
        <div className="dashboard-setor-header-left">
          <button
            type="button"
            className="dashboard-setor-status-indicator tablet-status-trigger"
            aria-label={`${freshness.label}. Toque longo para diagnóstico.`}
            onPointerDown={startLongPress}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(event) => {
              event.preventDefault();
              setShowDiagnostics(true);
            }}
          >
            <span
              className={`dashboard-setor-connection-status ${freshness.statusClass}`}
              aria-hidden
            />
            <span>{freshness.label}</span>
          </button>
        </div>

        <div className="dashboard-setor-header-center" ref={sectorPickerRef}>
          <button
            type="button"
            className={[
              "tablet-sector-title-btn",
              showSectorPicker ? "is-open" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-haspopup="listbox"
            aria-expanded={showSectorPicker}
            aria-label={`Trocar setor. Atual: ${config.sector}`}
            disabled={sectorOptions.length === 0}
            onClick={() => setShowSectorPicker((v) => !v)}
          >
            <h1>OPs na {config.sector}</h1>
            {sectorOptions.length > 1 ? (
              <ChevronDown className="tablet-sector-title-chevron" aria-hidden />
            ) : null}
          </button>
          {showSectorPicker ? (
            <div
              className="tablet-sector-picker"
              role="listbox"
              aria-label="Setores permitidos"
            >
              {sectorOptions.map((setor) => {
                const selected = setor === config.sector;
                return (
                  <button
                    key={setor}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={[
                      "tablet-sector-picker-option",
                      selected ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => handleSelectSector(setor)}
                  >
                    {setor}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="dashboard-setor-header-right">
          <PainelOsInstallButton />
          <button
            type="button"
            className={[
              "dashboard-setor-settings-btn",
              "tablet-push-toggle",
              pushEnabled ? "is-on" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => void handleTogglePush()}
            disabled={pushBusy || !isAuthenticated}
            aria-pressed={pushEnabled}
            aria-label={
              pushEnabled
                ? "Desativar notificações de OS nova no setor"
                : "Ativar notificações de OS nova no setor"
            }
            title={
              pushEnabled
                ? "Notificações ligadas"
                : "Notificações desligadas"
            }
          >
            {pushEnabled ? (
              <Bell className="size-5" />
            ) : (
              <BellOff className="size-5" />
            )}
          </button>
          <button
            type="button"
            className="dashboard-setor-settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Configurações do painel tablet"
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
              {col.items.map((os) => {
                const { label: osLabel, style: osLabelStyle } =
                  resolveOsCardLabel(os);
                const fornecedorBadges = resolveOsFornecedorBadges(os);
                return (
                  <button
                    key={os.uniqueKey}
                    type="button"
                    className={[
                      "dashboard-setor-card",
                      os.isNew ? "is-new" : "",
                      os.priorityType ?? "",
                      os.row_kind === "sub_os" ? "sub-os-card" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (isRecebimentoChapasTabletCard(os)) {
                        setRecebimentoItem(os);
                        return;
                      }
                      setSelectedItem(os);
                    }}
                  >
                    <div className="dashboard-setor-card-header">
                      <span
                        className="dashboard-setor-os-number"
                        style={osLabelStyle}
                        title={osLabel}
                      >
                        {osLabel}
                      </span>
                    </div>
                    <div
                      className="dashboard-setor-os-situation"
                      title={os.displaySituacao}
                    >
                      {os.displaySituacao}
                    </div>
                    {fornecedorBadges.length > 0 ? (
                      <div className="dashboard-setor-fornecedor-badges">
                        {fornecedorBadges.map((label) => (
                          <span
                            key={label}
                            className="dashboard-setor-fornecedor-badge"
                            title={label}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })}
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
        setoresList={settingsSetores}
        andamentosList={andamentosList}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
        onClearCache={handleClearCache}
      />

      {selectedItem ? (
        <TabletOsModal
          item={selectedItem}
          panelSector={config.sector}
          identityMode={identityMode}
          onClose={() => setSelectedItem(null)}
          onAndamentoSaved={() => {
            void fetchData();
          }}
        />
      ) : null}

      {recebimentoItem ? (
        <TabletRecebimentoChapasModal
          item={recebimentoItem}
          identityMode={identityMode}
          onClose={() => setRecebimentoItem(null)}
          onConfirmed={() => {
            setRecebimentoItem(null);
            void fetchData();
          }}
        />
      ) : null}

      <TabletDiagnosticsPanel
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        wsStatus={wsStatus}
        wsLastError={wsLastError}
        wsReconnectAttempt={wsReconnectAttempt}
        wsReconnect={wsReconnect}
        lastSyncAt={lastSyncAt}
        fetchError={fetchError}
      />
    </div>
  );
}
