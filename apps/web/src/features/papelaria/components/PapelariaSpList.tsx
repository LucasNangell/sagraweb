import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Send,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@sagra/ui";

import { fetchPapelariaSpStatusResumo } from "@/api/papelaria";
import { useOsSearch } from "@/api/hooks/useOsSearch";
import { useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { queryKeys } from "@/api/query-keys";
import { MultiSelect } from "@/components/ui/multi-select";
import { useAuthStore } from "@/features/auth/authStore";
import { defaultOsFilters } from "@/features/os/osFiltersStore";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import { authenticatedWsPath } from "@/lib/websocket";
import type { OsSearchFilters, OsSearchRow } from "@/features/os/types";
import { sameOsRow } from "../papelariaSelection";
import {
  isSpStatusInFlight,
  papelariaSpStatusKey,
  resolveSpImposicaoCell,
  resolveSpProvaCell,
  type PapelariaSpStatusResumoItem,
  type SpPipelineIcon,
} from "../papelariaSpPipelineUi";
import {
  loadPapelariaSpSituacoes,
  savePapelariaSpSituacoes,
} from "../papelariaSpSituacoesPrefs";
import { PapelariaSpTramitacao } from "./PapelariaSpTramitacao";

type Props = {
  selected: OsSearchRow | null;
  /** Lista de andamentos aberta no item selecionado. */
  expanded?: boolean;
  onSelect: (row: OsSearchRow) => void;
  className?: string;
};

/** Eventos WS que mudam Prova/Imposição de uma SP (de qualquer usuário). */
type SpStatusWsMessage = {
  type?: string;
  action?: string;
  ano?: number;
  nro?: number;
  id?: number;
};

const STATUS_REFRESH_DEBOUNCE_MS = 600;
const STATUS_POLL_IDLE_MS = 30_000;
const STATUS_POLL_IN_FLIGHT_MS = 5_000;

export function buildPapelariaSpFilters(situacoes: string[]): OsSearchFilters {
  return {
    ...defaultOsFilters(),
    anos: [],
    situacao: situacoes,
    setor: ["SEFOC"],
    includeFinished: false,
    includeOs: false,
    includeSp: true,
    page: 1,
    limit: 500,
    fetchAll: true,
    includeTotal: false,
    sortBy: "nr_os",
    sortDir: "asc",
    sorts: [{ column: "nr_os", dir: "asc" }],
  };
}

const LIST_COLUMNS =
  "grid grid-cols-[calc(4ch+0.85rem)_calc(4ch+0.85rem)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(4.5rem,0.7fr)_3.5rem_6.25rem] items-center";

function formatTiragem(value: string | number | null | undefined): string {
  if (value == null || String(value).trim() === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
      value,
    );
  }
  return String(value).trim();
}

function PipelineIcon({
  icon,
  label,
  muted = false,
}: {
  icon: SpPipelineIcon;
  label: string;
  muted?: boolean;
}) {
  const common = "size-3.5 shrink-0";
  if (icon === "alert") {
    return (
      <AlertTriangle
        className={cn(common, "text-amber-500")}
        aria-label={label}
        data-icon="alert"
      />
    );
  }
  if (icon === "clock") {
    return (
      <Clock
        className={cn(common, "text-amber-600")}
        aria-label={label}
        data-icon="clock"
      />
    );
  }
  if (icon === "loader") {
    return (
      <Loader2
        className={cn(
          common,
          "animate-spin",
          muted ? "text-neutral-400" : "text-secondary-blue",
        )}
        aria-label={label}
        data-icon="loader"
      />
    );
  }
  if (icon === "send") {
    return (
      <Send
        className={cn(common, "text-secondary-blue")}
        aria-label={label}
        data-icon="send"
      />
    );
  }
  return (
    <Check
      className={cn(common, "text-emerald-600")}
      aria-label={label}
      data-icon="check"
    />
  );
}

export function PapelariaSpList({
  selected,
  expanded = true,
  onSelect,
  className,
}: Props) {
  const [situacoes, setSituacoes] = useState<string[]>(() =>
    loadPapelariaSpSituacoes(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSituacoes, setDraftSituacoes] = useState<string[]>(situacoes);

  const situacoesQuery = useSituacoesLookup();
  const filters = useMemo(
    () => buildPapelariaSpFilters(situacoes),
    [situacoes],
  );
  const searchEnabled = situacoes.length > 0;
  const searchQuery = useOsSearch(filters, searchEnabled);
  const rows = searchQuery.data?.data ?? [];
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerOffset, setHeaderOffset] = useState(0);

  const statusItems = useMemo(
    () => rows.map((row) => ({ ano: row.ano, nro: row.nr_os })),
    [rows],
  );
  const statusFingerprint = useMemo(
    () =>
      statusItems
        .map((item) => `${item.ano}-${item.nro}`)
        .sort()
        .join("|"),
    [statusItems],
  );

  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.papelaria.spStatusResumo(statusFingerprint || "empty"),
    queryFn: () => fetchPapelariaSpStatusResumo(statusItems),
    enabled: statusItems.length > 0,
    // Estado é do servidor (compartilhado): com algo processando, consulta
    // mais rápido; o WebSocket antecipa as mudanças feitas por qualquer usuário.
    refetchInterval: (query) =>
      query.state.data?.items.some(isSpStatusInFlight)
        ? STATUS_POLL_IN_FLIGHT_MS
        : STATUS_POLL_IDLE_MS,
    staleTime: 2_000,
  });

  const listedKeys = useMemo(
    () =>
      new Set(
        statusItems.map((item) => papelariaSpStatusKey(item.ano, item.nro)),
      ),
    [statusItems],
  );
  const listedKeysRef = useRef(listedKeys);
  listedKeysRef.current = listedKeys;
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleStatusRefresh = useCallback(() => {
    if (refreshTimerRef.current != null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: ["papelaria", "spStatusResumo"],
      });
    }, STATUS_REFRESH_DEBOUNCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  const ponto = useAuthStore((s) => s.user?.ponto);
  useSagraWebSocket<SpStatusWsMessage>({
    path: authenticatedWsPath(ponto != null ? String(ponto) : null),
    enabled: statusItems.length > 0,
    onMessage: (data) => {
      const type = data?.type;
      if (
        type !== "papelaria_job_update" &&
        type !== "papelaria_sp_activity" &&
        type !== "system_update"
      ) {
        return;
      }
      const nro = data.nro ?? data.id;
      if (typeof data.ano !== "number" || typeof nro !== "number") return;
      if (!listedKeysRef.current.has(papelariaSpStatusKey(data.ano, nro))) {
        return;
      }
      scheduleStatusRefresh();
    },
  });

  const statusBySp = useMemo(() => {
    const map: Record<string, PapelariaSpStatusResumoItem> = {};
    for (const item of statusQuery.data?.items ?? []) {
      map[papelariaSpStatusKey(item.ano, item.nro)] = item as PapelariaSpStatusResumoItem;
    }
    return map;
  }, [statusQuery.data]);

  const openSettings = () => {
    setDraftSituacoes(situacoes);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    savePapelariaSpSituacoes(draftSituacoes);
    setSituacoes([...draftSituacoes]);
    setSettingsOpen(false);
  };

  useEffect(() => {
    const node = headerRef.current;
    if (!node) {
      return;
    }
    const measure = () => setHeaderOffset(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length]);

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm",
        className,
      )}
      aria-label="Lista de SPs no SEFOC"
      data-testid="papelaria-sp-list"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sagra-border bg-slate-50/80 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-xs font-bold text-secondary-blue">SPs — SEFOC</h2>
          <p className="truncate text-[10px] text-neutral-500">
            {situacoes.length === 0
              ? "Configure as situações na engrenagem"
              : searchQuery.isLoading
                ? "Carregando…"
                : `${rows.length} SP(s)`}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border border-sagra-border bg-white text-secondary-blue transition hover:bg-slate-50"
          title="Configurar situações da lista"
          aria-label="Configurar situações da lista"
          data-testid="papelaria-sp-list-settings"
          onClick={openSettings}
        >
          <Settings2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-papelaria-sp-scroll="">
        {situacoes.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            Nenhuma situação selecionada. Use a engrenagem para escolher os
            andamentos que devem aparecer nesta lista.
          </p>
        ) : searchQuery.isLoading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-6 text-xs text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando SPs…
          </p>
        ) : searchQuery.isError ? (
          <div className="space-y-2 p-4 text-center text-xs text-sagra-danger">
            <p>Erro ao carregar a lista de SPs.</p>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-1 text-red-800 hover:bg-red-50"
              onClick={() => void searchQuery.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            Nenhuma SP no SEFOC com as situações configuradas.
          </p>
        ) : (
          <div className="w-full text-[11px]" role="table">
            <div
              ref={headerRef}
              className={cn(
                LIST_COLUMNS,
                "sticky top-0 z-30 bg-slate-100 text-left",
              )}
              role="row"
            >
                <div className="whitespace-nowrap px-1 py-1.5 text-center font-semibold" role="columnheader">
                  Nr SP
                </div>
                <div className="whitespace-nowrap px-1 py-1.5 text-center font-semibold" role="columnheader">
                  Ano
                </div>
                <div className="px-2 py-1.5 font-semibold" role="columnheader">Produto</div>
                <div className="px-2 py-1.5 font-semibold" role="columnheader">Solicitante</div>
                <div className="px-2 py-1.5 font-semibold" role="columnheader">Situação</div>
                <div className="px-2 py-1.5 text-right font-semibold" role="columnheader">Tiragem</div>
                <div className="px-1 py-1.5 text-center font-semibold" role="columnheader">
                  Prova
                </div>
                <div className="whitespace-nowrap px-1 py-1.5 text-center font-semibold" role="columnheader">
                  Imposição
                </div>
            </div>
              {rows.map((row) => {
                const isSelected = sameOsRow(selected, row);
                const isExpanded = isSelected && expanded;
                const key = papelariaSpStatusKey(row.ano, row.nr_os);
                const resumo = statusBySp[key];
                // Sem resumo do servidor ainda: não inventar "pendente".
                const provaCell = resumo
                  ? resolveSpProvaCell(resumo.prova)
                  : null;
                const imposicaoCell = resumo
                  ? resolveSpImposicaoCell(resumo.imposicao)
                  : null;
                return (
                  <div key={`${row.ano}-${row.nr_os}`}>
                    <div
                      className={cn(
                        LIST_COLUMNS,
                        "cursor-pointer border-b border-neutral-100 transition",
                        isExpanded
                          ? "sticky z-20 bg-[color-mix(in_srgb,var(--secondary-blue)_12%,white)] shadow-[0_2px_4px_rgba(15,23,42,0.12)]"
                          : isSelected
                            ? "bg-secondary-blue/10"
                            : "hover:bg-slate-50",
                      )}
                      style={isExpanded ? { top: headerOffset } : undefined}
                      onClick={() => onSelect(row)}
                      aria-selected={isSelected}
                      role="row"
                      data-testid={`papelaria-sp-row-${row.nr_os}-${row.ano}`}
                    >
                    <div className="px-1 py-1.5 text-center font-mono font-semibold tabular-nums text-secondary-blue" role="cell">
                      {row.nr_os}
                    </div>
                    <div className="px-1 py-1.5 text-center tabular-nums" role="cell">
                      {row.ano}
                    </div>
                    <div
                      className="min-w-0 truncate px-2 py-1.5"
                      title={row.produto ?? undefined}
                      role="cell"
                    >
                      {row.produto ?? "—"}
                    </div>
                    <div
                      className="min-w-0 truncate px-2 py-1.5"
                      title={row.solicitante ?? undefined}
                      role="cell"
                    >
                      {row.solicitante ?? "—"}
                    </div>
                    <div
                      className="min-w-0 truncate px-2 py-1.5"
                      title={row.situacao ?? undefined}
                      role="cell"
                      data-testid={`papelaria-sp-situacao-${row.nr_os}`}
                    >
                      {row.situacao?.trim() || "—"}
                    </div>
                    <div
                      className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                      role="cell"
                      data-testid={`papelaria-sp-tiragem-${row.nr_os}`}
                    >
                      {formatTiragem(row.tiragem)}
                    </div>
                    <div
                      className="px-1 py-1.5 text-center"
                      title={provaCell?.label}
                      role="cell"
                      data-testid={`papelaria-sp-prova-${row.nr_os}`}
                    >
                      {provaCell ? (
                        <span className="inline-flex items-center justify-center gap-0.5">
                          {provaCell.versao != null ? (
                            <span className="font-mono text-[10px] font-semibold text-neutral-700">
                              {provaCell.versao}
                            </span>
                          ) : null}
                          <PipelineIcon
                            icon={provaCell.icon}
                            label={provaCell.label}
                            muted={provaCell.muted}
                          />
                        </span>
                      ) : statusQuery.isError ? (
                        <span className="text-[10px] text-neutral-400" title="Falha ao carregar status">
                          —
                        </span>
                      ) : (
                        <Loader2
                          className="mx-auto size-3 animate-spin text-neutral-300"
                          aria-label="Carregando status"
                        />
                      )}
                    </div>
                    <div
                      className="px-1 py-1.5 text-center"
                      title={imposicaoCell?.label || undefined}
                      role="cell"
                      data-testid={`papelaria-sp-imposicao-${row.nr_os}`}
                    >
                      {imposicaoCell?.icon ? (
                        <span className="inline-flex items-center justify-center">
                          <PipelineIcon
                            icon={imposicaoCell.icon}
                            label={imposicaoCell.label}
                            muted={imposicaoCell.muted}
                          />
                        </span>
                      ) : null}
                    </div>
                    </div>
                    {isExpanded ? (
                      <div className="border-b border-neutral-100 bg-secondary-blue/5">
                        <PapelariaSpTramitacao row={row} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="papelaria-sp-situacoes-title"
            data-testid="papelaria-sp-situacoes-modal"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3
                  id="papelaria-sp-situacoes-title"
                  className="text-sm font-bold text-secondary-blue"
                >
                  Situações da lista
                </h3>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Exibe apenas SPs no setor SEFOC cujo andamento atual esteja
                  entre as situações selecionadas.
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                aria-label="Fechar"
                onClick={() => setSettingsOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <MultiSelect
              label="Situações"
              options={situacoesQuery.data ?? []}
              value={draftSituacoes}
              onChange={setDraftSituacoes}
              isLoading={situacoesQuery.isLoading}
              placeholder="Selecione as situações…"
              testId="papelaria-sp-situacoes-select"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                onClick={() => setSettingsOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--primary sagra-btn--sm"
                onClick={saveSettings}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
