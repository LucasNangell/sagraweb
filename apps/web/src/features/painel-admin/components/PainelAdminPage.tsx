import { cn } from "@sagra/ui";
import {
  Columns3,
  Monitor,
  Palette,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Type,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { fetchAndamentos } from "@/api/pcp";
import { fetchSetores } from "@/api/auxLookups";
import {
  fetchPainelAdminInstances,
  fetchPainelRemoteConfig,
  savePainelAdminConfig,
  savePainelAdminInstance,
  type PainelRemoteInstance,
} from "@/api/painelRemote";
import { DashboardSetorSettingsForm } from "@/features/dashboard-setor/components/DashboardSetorSettingsForm";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import { NOTIFICATION_SOUND_SLOTS } from "@/features/dashboard-setor/notificationSounds";
import type {
  DashboardConfig,
  DashboardNotificationSounds,
  DashboardTheme,
} from "@/features/dashboard-setor/types";
import { PainelCardPreview } from "@/features/painel-admin/components/PainelCardPreview";
import { PainelCardStyleForm } from "@/features/painel-admin/components/PainelCardStyleForm";
import { PainelNotificationSoundField } from "@/features/painel-admin/components/PainelNotificationSoundField";
import { PainelPresetsPanel } from "@/features/painel-admin/components/PainelPresetsPanel";
import {
  listenPreviewRequests,
  publishPreviewConfig,
} from "@/features/painel-admin/previewChannel";
import "@/features/configuracoes/components/configuracoesPage.css";

const POLL_MS = 3000;

type AdminTab = "geral" | "colunas" | "visual" | "animacao" | "fonte";

const ADMIN_TABS: Array<{
  id: AdminTab;
  label: string;
  icon: ReactNode;
}> = [
  { id: "geral", label: "Geral", icon: <Settings className="size-3.5" /> },
  { id: "colunas", label: "Colunas", icon: <Columns3 className="size-3.5" /> },
  { id: "visual", label: "Visual", icon: <Palette className="size-3.5" /> },
  { id: "animacao", label: "Animação", icon: <Sparkles className="size-3.5" /> },
  { id: "fonte", label: "Fonte", icon: <Type className="size-3.5" /> },
];

const ROUTE_LABELS: Record<string, string> = {
  setor: "Setor clássico",
  "setor-moderno": "Setor moderno",
  tablet: "Tablet",
  celular: "Celular",
};

function instanceTitle(row: PainelRemoteInstance): string {
  return row.nome.trim() || row.ip.trim() || row.clientId;
}

const THEME_DEFAULTS = {
  cardGap: 8,
  pageBg: "#0b1018",
  columnBg: "#111923",
};

function ThemeColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
      {label}
      <input
        type="color"
        className="h-8 w-full rounded border border-slate-300"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function PainelAdminPage() {
  const [instances, setInstances] = useState<PainelRemoteInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_DASHBOARD_CONFIG);
  const [setoresList, setSetoresList] = useState<string[]>([]);
  const [andamentosList, setAndamentosList] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("geral");
  const configRef = useRef(config);
  configRef.current = config;
  const profileRef = useRef({ nome, descricao });
  profileRef.current = { nome, descricao };

  const selected = useMemo(
    () => instances.find((row) => row.clientId === selectedId) ?? null,
    [instances, selectedId],
  );

  const refreshInstances = useCallback(async () => {
    const data = await fetchPainelAdminInstances();
    setInstances(data.instances);
    setLoadError(null);
    return data.instances;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSetores()
      .then((rows) => {
        if (!cancelled) setSetoresList(rows);
      })
      .catch((err) => console.warn("[paineis] setores", err));
    void fetchAndamentos()
      .then((rows) => {
        if (!cancelled) setAndamentosList(rows);
      })
      .catch((err) => console.warn("[paineis] andamentos", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void refreshInstances().catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Falha ao listar painéis.",
          );
        }
      });
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshInstances]);

  useEffect(() => {
    if (selectedId && !instances.some((row) => row.clientId === selectedId)) {
      setSelectedId(null);
    }
  }, [instances, selectedId]);

  const selectInstance = async (row: PainelRemoteInstance) => {
    setSelectedId(row.clientId);
    setNome(row.nome);
    setDescricao(row.descricao);
    setSaveError(null);
    setSavedAt(null);
    try {
      const remote = await fetchPainelRemoteConfig(row.clientId);
      if (remote.payload) {
        setConfig(
          normalizeDashboardConfigFromRemote(remote.payload, row.setor),
        );
      } else {
        setConfig(
          normalizeDashboardConfigFromRemote(
            { ...DEFAULT_DASHBOARD_CONFIG, sector: row.setor || DEFAULT_DASHBOARD_CONFIG.sector },
            row.setor,
          ),
        );
      }
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Falha ao carregar a configuração.",
      );
    }
  };

  const handleSave = async () => {
    if (!selected) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const latest = configRef.current;
      const nextConfig = normalizeDashboardConfigFromRemote(latest);
      await savePainelAdminConfig(selected.clientId, nextConfig);
      const profile = profileRef.current;
      const profileChanged =
        profile.nome !== selected.nome ||
        profile.descricao !== selected.descricao ||
        nextConfig.sector !== selected.setor;
      if (profileChanged) {
        await savePainelAdminInstance(selected.clientId, {
          nome: profile.nome,
          setor: nextConfig.sector,
          descricao: profile.descricao,
        });
      }
      setConfig(nextConfig);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
      await refreshInstances();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Falha ao salvar a configuração.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleConfigChange = (next: DashboardConfig) => {
    const normalized = normalizeDashboardConfigFromRemote(next);
    configRef.current = normalized;
    setConfig(normalized);
  };

  const handleCardStyleChange = (cardStyle: DashboardConfig["cardStyle"]) => {
    setConfig((prev) => {
      const next = cardStyle
        ? { ...prev, cardStyle }
        : (() => {
            const copy = { ...prev };
            delete copy.cardStyle;
            return copy;
          })();
      configRef.current = next;
      return next;
    });
  };

  const patchTheme = (partial: DashboardTheme) => {
    setConfig((prev) => {
      const merged: DashboardTheme = { ...prev.theme, ...partial };
      if ("headerBg2" in partial && !partial.headerBg2) {
        delete merged.headerBg2;
      }
      const next = normalizeDashboardConfigFromRemote({
        ...prev,
        theme: merged,
      });
      configRef.current = next;
      return next;
    });
  };

  useEffect(() => listenPreviewRequests(() => configRef.current), []);
  useEffect(() => {
    publishPreviewConfig(config);
  }, [config]);

  const styleSection =
    activeTab === "visual"
      ? "visual"
      : activeTab === "animacao"
        ? "animation"
        : activeTab === "fonte"
          ? "typography"
          : null;

  return (
    <div className="configuracoes-page-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col gap-4 px-4 py-4 xl:px-6">
        <header className="configuracoes-page-header shrink-0">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Monitor className="size-5 text-secondary-blue" />
            Painéis OS
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            Computadores exibindo /painel/setor, /painel/tablet ou
            /painel/setor-moderno. A configuração é a mesma nas três páginas e
            atualiza o painel aberto na hora ao salvar.
          </p>
        </header>

        {loadError && (
          <p className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(16rem,18rem)_minmax(0,3fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white max-xl:max-h-48 xl:order-1">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Exibindo agora ({instances.length})
              </h2>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                onClick={() => void refreshInstances()}
              >
                <RefreshCw className="size-3.5" />
                Atualizar
              </button>
            </div>
            {instances.length === 0 ? (
              <p className="px-3 py-6 text-sm text-slate-500">
                Nenhum painel OS conectado no momento.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                {instances.map((row) => {
                  const active = row.clientId === selectedId;
                  return (
                    <li key={row.clientId}>
                      <button
                        type="button"
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left ${
                          active ? "bg-sky-50" : "hover:bg-slate-50"
                        }`}
                        onClick={() => void selectInstance(row)}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <span
                            className="inline-block size-2 rounded-full bg-emerald-500"
                            aria-hidden
                          />
                          {instanceTitle(row)}
                        </span>
                        <span className="text-xs text-slate-600">
                          {row.setor || "Sem setor"} ·{" "}
                          {ROUTE_LABELS[row.route] || row.route || "Painel"}
                        </span>
                        {row.descricao.trim() ? (
                          <span className="text-xs text-slate-500">
                            {row.descricao}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white xl:order-2">
            {!selected ? (
              <p className="py-10 text-center text-sm text-slate-500">
                Selecione um computador à esquerda para definir nome, setor,
                descrição e o layout do painel.
              </p>
            ) : (
              <>
                <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                  <div
                    className="configuracoes-tab-list"
                    role="tablist"
                    aria-label="Configurações do painel"
                  >
                    {ADMIN_TABS.map((tab) => {
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          id={`painel-admin-tab-${tab.id}`}
                          role="tab"
                          aria-selected={active}
                          aria-controls={`painel-admin-panel-${tab.id}`}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                            active
                              ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
                              : "text-slate-600 hover:bg-white/60 hover:text-secondary-blue",
                          )}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          {tab.icon}
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="configuracoes-page-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                  <div
                    role="tabpanel"
                    id="painel-admin-panel-geral"
                    aria-labelledby="painel-admin-tab-geral"
                    hidden={activeTab !== "geral"}
                    className="flex flex-col gap-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                        Nome
                        <input
                          className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800"
                          value={nome}
                          onChange={(e) => setNome(e.target.value)}
                          placeholder="Ex.: TV SEFOC"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                        IP
                        <input
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-normal text-slate-600"
                          value={selected.ip}
                          readOnly
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                        Descrição
                        <input
                          className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800"
                          value={descricao}
                          onChange={(e) => setDescricao(e.target.value)}
                          placeholder="Ex.: Monitor do corredor"
                        />
                      </label>
                    </div>

                    <fieldset className="rounded-md border border-slate-200 p-3">
                      <legend className="px-1 text-xs font-semibold text-slate-700">
                        Aparência do board
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                          Espaçamento entre os cards (
                          {config.theme?.cardGap ?? THEME_DEFAULTS.cardGap}px)
                          <input
                            type="range"
                            min={0}
                            max={40}
                            step={1}
                            value={config.theme?.cardGap ?? THEME_DEFAULTS.cardGap}
                            onChange={(e) =>
                              patchTheme({ cardGap: Number(e.target.value) })
                            }
                          />
                        </label>
                        <ThemeColorField
                          label="Fundo do sistema"
                          value={config.theme?.pageBg}
                          fallback={THEME_DEFAULTS.pageBg}
                          onChange={(pageBg) => patchTheme({ pageBg })}
                        />
                        <ThemeColorField
                          label="Fundo das colunas"
                          value={config.theme?.columnBg}
                          fallback={THEME_DEFAULTS.columnBg}
                          onChange={(columnBg) => patchTheme({ columnBg })}
                        />
                      </div>
                    </fieldset>

                    <fieldset className="rounded-md border border-slate-200 p-3">
                      <legend className="px-1 text-xs font-semibold text-slate-700">
                        Som de notificação
                      </legend>
                      <p className="mb-3 text-xs text-slate-500">
                        Cada prioridade da OS pode ter um toque diferente. Os
                        toques prontos são originais, sem copyright. Também é
                        possível enviar um MP3 próprio.
                      </p>
                      <div className="space-y-3">
                        {NOTIFICATION_SOUND_SLOTS.map((slot) => (
                          <PainelNotificationSoundField
                            key={slot.id}
                            title={slot.title}
                            value={config.notificationSounds?.[slot.id]}
                            fallback={config.notificationSound}
                            onChange={(sound) => {
                              const current = configRef.current;
                              const nextSounds: DashboardNotificationSounds = {
                                ...current.notificationSounds,
                                [slot.id]: sound,
                              };
                              handleConfigChange({
                                ...current,
                                notificationSounds: nextSounds,
                              });
                            }}
                          />
                        ))}
                      </div>
                    </fieldset>

                    <PainelPresetsPanel
                      config={config}
                      onApply={handleConfigChange}
                    />
                  </div>

                  <div
                    role="tabpanel"
                    id="painel-admin-panel-colunas"
                    aria-labelledby="painel-admin-tab-colunas"
                    hidden={activeTab !== "colunas"}
                    className="flex flex-col gap-4"
                  >
                    <DashboardSetorSettingsForm
                      config={config}
                      setoresList={setoresList}
                      andamentosList={andamentosList}
                      onChange={handleConfigChange}
                      showTimeOption
                      idPrefix="painel-admin"
                      variant="admin"
                    />
                  </div>

                  <div
                    role="tabpanel"
                    id={`painel-admin-panel-${styleSection ?? "visual"}`}
                    aria-labelledby={`painel-admin-tab-${styleSection ?? "visual"}`}
                    hidden={!styleSection}
                  >
                    <PainelCardStyleForm
                      section={styleSection ?? "visual"}
                      value={config.cardStyle}
                      onChange={handleCardStyleChange}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-4 py-3">
                  {saveError ? (
                    <p className="mr-auto text-sm text-red-700">{saveError}</p>
                  ) : savedAt ? (
                    <span className="mr-auto text-xs text-slate-500">
                      Salvo às {savedAt} — painel atualizado
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="sagra-btn sagra-btn--secondary sagra-btn--md"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    <Save className="size-4" />
                    {saving ? "Salvando…" : "Salvar"}
                  </button>
                </div>
              </>
            )}
          </section>

          <aside className="order-first flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white max-xl:max-h-[40vh] xl:order-3 xl:max-h-none">
            <PainelCardPreview config={config} />
          </aside>
        </div>
      </div>
    </div>
  );
}
