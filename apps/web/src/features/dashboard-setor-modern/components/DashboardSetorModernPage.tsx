import {
  Check,
  ChevronRight,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings2,
  WifiOff,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { DashboardSetorSettingsModal } from "@/features/dashboard-setor/components/DashboardSetorSettingsModal";
import { useDashboardFreshness } from "@/features/dashboard-setor/hooks/useDashboardFreshness";
import { useDashboardSetorData } from "@/features/dashboard-setor/hooks/useDashboardSetorData";
import { useScreenWakeLock } from "@/features/dashboard-setor/hooks/useScreenWakeLock";
import {
  normalizeDashboardConfigFromRemote,
  showsAndamentoTime,
} from "@/features/dashboard-setor/normalizeConfig";
import type { DashboardConfig } from "@/features/dashboard-setor/types";
import {
  buildDashboardConfigSignature,
  getVisibleDashboardColumns,
} from "@/features/dashboard-setor/utils";
import { useSyncAndamentosServiceAlert } from "@/features/sync-andamentos/useSyncAndamentosServiceAlert";
import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";

import {
  loadModernDashboardConfig,
  saveModernDashboardConfig,
} from "../configStorage";
import { useBoardMotion } from "../hooks/useBoardMotion";
import { useSectorArrivalSound } from "../hooks/useSectorArrivalSound";
import { sortModernDashboardColumns } from "../sortColumns";
import { AndamentoClock } from "./AndamentoTimer";
import { ModernQueueCard } from "./ModernQueueCard";
import "../dashboard-setor-modern.css";

export function DashboardSetorModernPage() {
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const userSector = useAuthStore((s) => s.user?.setor);
  const [config, setConfig] = useState(() =>
    loadModernDashboardConfig(userSector),
  );
  const configRef = useRef(config);
  configRef.current = config;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const { playArrivalSound } = useSectorArrivalSound();
  useScreenWakeLock();

  useUserPreferenceSync({
    key: "painel_setor_moderno",
    enabled: authenticated,
    watchValue: config,
    onRemoteLoaded: (remote) => {
      const next = normalizeDashboardConfigFromRemote(remote, userSector);
      const current = configRef.current;
      if (
        buildDashboardConfigSignature(next) !==
          buildDashboardConfigSignature(current) ||
        showsAndamentoTime(next) !== showsAndamentoTime(current)
      ) {
        saveModernDashboardConfig(next);
        setConfig(next);
      }
    },
  });

  const data = useDashboardSetorData({
    config,
    onSectorArrival: () => {
      void playArrivalSound();
    },
  });
  const freshness = useDashboardFreshness(data);
  const syncAlert = useSyncAndamentosServiceAlert();
  const showTime = showsAndamentoTime(config);
  const columns = useMemo(
    () => sortModernDashboardColumns(getVisibleDashboardColumns(data.columns)),
    [data.columns],
  );
  const total = columns.reduce((sum, col) => sum + col.items.length, 0);
  useBoardMotion(boardRef, columns, {
    sectorItemKeys: data.sectorItemKeys,
    configKey: buildDashboardConfigSignature(config),
    enabled: data.hasLoadedOnce,
  });

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // O modal compartilhado mantém todas as configurações; o contêiner adiciona foco e Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const dialog =
      rootRef.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      settingsButton.current?.focus();
    };
  }, [settingsOpen]);

  const applyConfig = (next: DashboardConfig) => {
    const normalized = normalizeDashboardConfigFromRemote(next, userSector);
    saveModernDashboardConfig(normalized);
    setConfig(normalized);
    setSettingsOpen(false);
  };

  const toggleFullscreen = async () => {
    try {
      setFullscreenError(null);
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      setFullscreenError(
        "Não foi possível ativar a tela cheia neste navegador.",
      );
    }
  };

  const status = syncAlert
    ? "Sincronização de andamentos interrompida"
    : data.fetchError
      ? "Falha ao atualizar os dados"
      : freshness.level === "live"
        ? "Em tempo real"
        : freshness.level === "degraded"
          ? "Atualização periódica"
          : freshness.level === "loading"
            ? "Conectando"
            : "Aguardando sincronização";

  return (
    <div className="setor-modern" ref={rootRef}>
      <div className="setor-modern-workspace" inert={settingsOpen || undefined}>
        <header className="setor-modern-header">
          <div className="setor-modern-identity">
            <div className="setor-modern-mark" aria-hidden="true">
              <LayoutDashboard size={23} />
            </div>
            <div>
              <div className="setor-modern-eyebrow">
                SAGRA <ChevronRight size={10} /> PAINEL DE PRODUÇÃO
              </div>
              <div
                className={`setor-modern-connection ${syncAlert || data.fetchError ? "is-alert" : freshness.statusClass}`}
                role="status"
              >
                <i aria-hidden="true" />
                <div>
                  <strong>{status}</strong>
                  <span>{freshness.label}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="setor-modern-heading">
            <h1 title={`OPs na ${config.sector}`}>OPs na {config.sector}</h1>
          </div>
          <div className="setor-modern-actions">
            {document.fullscreenEnabled && (
              <button
                className="setor-modern-button setor-modern-icon-button"
                type="button"
                onClick={() => {
                  void toggleFullscreen();
                }}
                aria-label={
                  fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"
                }
              >
                {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            )}
            <button
              ref={settingsButton}
              className="setor-modern-button setor-modern-icon-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Configurações do painel"
              title="Configurar painel"
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        <main className="setor-modern-main">
          {(data.fetchError || fullscreenError || syncAlert) && (
            <div className="setor-modern-notice" role="alert">
              <WifiOff size={16} />
              <span>
                {fullscreenError ??
                  (syncAlert
                    ? "O serviço de sincronização de andamentos está parado. Os dados podem estar desatualizados."
                    : data.hasLoadedOnce
                      ? "Não foi possível atualizar. Exibindo os últimos dados recebidos."
                      : "Não foi possível carregar as OPs.")}
              </span>
              {data.fetchError && (
                <button
                  type="button"
                  onClick={() => {
                    void data.fetchData();
                  }}
                  disabled={data.isFetching}
                >
                  <RefreshCw
                    size={14}
                    className={data.isFetching ? "is-spinning" : ""}
                  />
                  Tentar novamente
                </button>
              )}
            </div>
          )}

          <AndamentoClock enabled={showTime}>
            <div
              className="setor-modern-board"
              ref={boardRef}
              style={
                {
                  "--column-count": Math.max(columns.length, 1),
                } as CSSProperties
              }
              aria-label="Fila de produção por etapa"
              aria-busy={!data.hasLoadedOnce && data.isFetching}
            >
              {columns.map((col, index) => (
                <section
                  className="setor-modern-lane"
                  key={col.id}
                  style={
                    {
                      "--lane": index % 6,
                      "--column-index": index,
                    } as CSSProperties
                  }
                  aria-label={col.title}
                >
                  <header className="setor-modern-lane-header">
                    <div>
                      <i aria-hidden="true" />
                      <h2 title={col.title}>{col.title}</h2>
                      {col.items.length > 0 && (
                        <span
                          className="setor-modern-lane-count"
                          key={col.items.length}
                        >
                          {col.items.length}
                        </span>
                      )}
                    </div>
                    <div className="setor-modern-lane-meter" aria-hidden="true">
                      <span
                        style={{
                          width: `${total ? (col.items.length / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </header>
                  <div
                    className="setor-modern-lane-content"
                    tabIndex={0}
                    role="region"
                    aria-label={`OPs em ${col.title}`}
                  >
                    {!data.hasLoadedOnce && !data.fetchError ? (
                      <div
                        className="setor-modern-skeletons"
                        aria-label="Carregando OPs"
                      >
                        {[0, 1, 2].map((n) => (
                          <div className="setor-modern-skeleton" key={n}>
                            <i />
                            <i />
                            <i />
                          </div>
                        ))}
                      </div>
                    ) : col.items.length ? (
                      col.items.map((item, cardIndex) => (
                        <ModernQueueCard
                          key={item.uniqueKey}
                          item={item}
                          index={cardIndex}
                          showTime={showTime}
                        />
                      ))
                    ) : null}
                  </div>
                  <footer className="setor-modern-lane-footer">
                    <span>
                      {col.items.length > 0
                        ? `${col.items.length} ${col.items.length === 1 ? "OP" : "OPs"}`
                        : ""}
                    </span>
                  </footer>
                </section>
              ))}
              {columns.length === 0 && (
                <div className="setor-modern-all-empty">
                  <Check size={28} />
                  <h2>Nenhuma etapa com OPs</h2>
                  <p>
                    As colunas vazias estão ocultas conforme a configuração.
                  </p>
                  <button
                    type="button"
                    className="setor-modern-button"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Configurar colunas
                  </button>
                </div>
              )}
            </div>
          </AndamentoClock>
        </main>
      </div>

      <DashboardSetorSettingsModal
        open={settingsOpen}
        config={config}
        setoresList={data.setoresList}
        andamentosList={data.andamentosList}
        onClose={() => setSettingsOpen(false)}
        onSave={applyConfig}
        showTimeOption
        onClearCache={() =>
          applyConfig({
            ...DEFAULT_DASHBOARD_CONFIG,
            sector: userSector || DEFAULT_DASHBOARD_CONFIG.sector,
          })
        }
      />
    </div>
  );
}
