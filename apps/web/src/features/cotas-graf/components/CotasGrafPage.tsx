import { Coins, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOsFilterYears } from "@/api/hooks/useOsFilterOptions";
import {
  useCotasGrafList,
  useCotasGrafSolicitantesCotas,
  useLancarCotasGrafMutation,
} from "@/api/hooks/useCotasGraf";
import {
  useSavedFilters,
  useUserFiltersDefault,
} from "@/api/hooks/useSavedFilters";
import type { CotasGrafItem } from "@/api/cotasGraf";
import { useAuthStore } from "@/features/auth/authStore";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMatchMedia } from "@/hooks/useMatchMedia";
import {
  getDefaultFromYearValue,
  resolveDefaultYear,
} from "@/features/os/osFilterDefaults";
import type { SavedFilter } from "@/features/os/types";

import { buildCotasGrafSearchFilters } from "../cotasGrafSearchUtils";
import { useCotasGrafFiltersStore } from "../cotasGrafFiltersStore";
import {
  getCotasGrafActiveFilterLabels,
  getCotasGrafImplicitFilterHints,
  getCotasGrafTextFilterMinLengthHint,
  hasCotasGrafTextFilterBelowMinLength,
} from "../filterStatus";
import {
  COTAS_GRAF_MOBILE_PAGE_SIZE,
  DEFAULT_COTAS_GRAF_PAGE_SIZE,
} from "../types";
import { CotasGrafFiltersPanel } from "./CotasGrafFiltersPanel";
import { CotasGrafListPagination } from "./CotasGrafListPagination";
import { CotasGrafSettingsModal } from "./CotasGrafSettingsModal";
import { CotasGrafSolicitantesPanel } from "./CotasGrafSolicitantesPanel";

let cotasGrafDefaultPrefsApplied = false;
let cotasGrafSavedFilterId = "";
let cotasGrafSavedFilterName: string | null = null;

function formatOsLabel(nrOs: number, ano: number): string {
  return `${String(nrOs).padStart(5, "0")}/${String(ano).slice(-2)}`;
}

function CotasGrafActionButton({
  item,
  onLancar,
  pending,
}: {
  item: CotasGrafItem;
  onLancar: (item: CotasGrafItem) => void;
  pending: boolean;
}) {
  if (item.cotas_graf_atualizado) {
    return (
      <button
        type="button"
        disabled
        onClick={(e) => e.stopPropagation()}
        className="rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600"
      >
        CotasGraf Atualizado
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        onLancar(item);
      }}
      className="rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-4 animate-spin" />
          Lançando…
        </span>
      ) : (
        "Lançar no CotasGraf"
      )}
    </button>
  );
}

export function CotasGrafPage() {
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const filters = useCotasGrafFiltersStore((s) => s.filters);
  const patchFilters = useCotasGrafFiltersStore((s) => s.patchFilters);
  const setPage = useCotasGrafFiltersStore((s) => s.setPage);
  const isMobile = useMatchMedia("(max-width: 767px)");
  const launchListRef = useRef<HTMLDivElement>(null);

  const [savedFilterId, setSavedFilterId] = useState(cotasGrafSavedFilterId);
  const [savedFilterName, setSavedFilterName] = useState<string | null>(
    cotasGrafSavedFilterName,
  );
  const [manualRefresh, setManualRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [cotasSolicitanteFilter, setCotasSolicitanteFilter] = useState<
    string | null
  >(null);
  const [prefsBootstrapped, setPrefsBootstrapped] = useState(
    cotasGrafDefaultPrefsApplied,
  );

  useEffect(() => {
    cotasGrafSavedFilterId = savedFilterId;
    cotasGrafSavedFilterName = savedFilterName;
  }, [savedFilterId, savedFilterName]);

  useEffect(() => {
    const targetLimit = isMobile
      ? COTAS_GRAF_MOBILE_PAGE_SIZE
      : DEFAULT_COTAS_GRAF_PAGE_SIZE;
    if (filters.limit !== targetLimit) {
      patchFilters({ limit: targetLimit, page: 1 });
    }
  }, [filters.limit, isMobile, patchFilters]);

  const debouncedTextFilters = useDebouncedValue(
    {
      nrOs: filters.nrOs,
      titulo: filters.titulo,
    },
    450,
  );

  const debouncedChoiceFilters = useDebouncedValue(
    {
      situacaoCotas: filters.situacaoCotas,
    },
    200,
  );

  const searchFilters = useMemo(
    () =>
      buildCotasGrafSearchFilters(
        {
          ...filters,
          situacaoCotas: debouncedChoiceFilters.situacaoCotas,
        },
        debouncedTextFilters,
      ),
    [debouncedChoiceFilters, debouncedTextFilters, filters],
  );

  const solicitantesSearchFilters = useMemo(
    () =>
      cotasSolicitanteFilter
        ? {
            ...searchFilters,
            solicitantes: [cotasSolicitanteFilter],
            solicitante: "",
          }
        : searchFilters,
    [cotasSolicitanteFilter, searchFilters],
  );

  const textBelowMinLength = useMemo(
    () => hasCotasGrafTextFilterBelowMinLength(filters),
    [filters],
  );

  const isTextFilterPending = useMemo(
    () =>
      !textBelowMinLength &&
      (filters.nrOs !== debouncedTextFilters.nrOs ||
        filters.titulo !== debouncedTextFilters.titulo),
    [debouncedTextFilters, filters, textBelowMinLength],
  );

  const isChoiceFilterPending = useMemo(
    () => filters.situacaoCotas !== debouncedChoiceFilters.situacaoCotas,
    [debouncedChoiceFilters, filters],
  );

  const listQuery = useCotasGrafList(searchFilters, prefsBootstrapped);
  const solicitantesQuery = useCotasGrafSolicitantesCotas(
    solicitantesSearchFilters,
    prefsBootstrapped,
  );
  const lancarMutation = useLancarCotasGrafMutation();

  const savedFiltersQuery = useSavedFilters(ponto, "cotas_graf");
  const defaultFiltersQuery = useUserFiltersDefault(ponto, "cotas_graf");
  const yearsQuery = useOsFilterYears(prefsBootstrapped);
  const defaultYearAdjusted = useRef(false);

  useEffect(() => {
    if (!prefsBootstrapped || defaultYearAdjusted.current) {
      return;
    }
    const years = yearsQuery.data?.data;
    if (!years?.length) {
      return;
    }
    const preferred = getDefaultFromYearValue();
    if (filters.ano !== preferred) {
      defaultYearAdjusted.current = true;
      return;
    }
    const resolved = resolveDefaultYear(preferred, years);
    if (resolved !== filters.ano) {
      patchFilters({ ano: resolved, page: 1 });
    }
    defaultYearAdjusted.current = true;
  }, [filters.ano, patchFilters, prefsBootstrapped, yearsQuery.data]);

  const applySavedFilter = useCallback(
    (filter: SavedFilter) => {
      patchFilters({
        nrOs: undefined,
        ano: undefined,
        produto: "",
        produtos: [],
        titulo: "",
        solicitante: "",
        solicitantes: [],
        situacaoCotas: filter.situacoes ?? [],
        page: 1,
      });
      setSavedFilterId(String(filter.id));
      setSavedFilterName(filter.nome);
    },
    [patchFilters],
  );

  useEffect(() => {
    if (cotasGrafDefaultPrefsApplied || prefsBootstrapped) {
      return;
    }
    if (!ponto) {
      cotasGrafDefaultPrefsApplied = true;
      setPrefsBootstrapped(true);
      return;
    }
    if (!defaultFiltersQuery.isFetched) {
      return;
    }

    const data = defaultFiltersQuery.data;
    if (data?.situacoes?.length) {
      patchFilters({
        situacaoCotas: data.situacoes ?? [],
        page: 1,
      });
    }
    if (data?.nome_filtro) {
      setSavedFilterName(data.nome_filtro);
      const list = savedFiltersQuery.data;
      if (list) {
        const found = list.find((f) => f.nome === data.nome_filtro);
        if (found) {
          setSavedFilterId(String(found.id));
        }
      }
    }
    cotasGrafDefaultPrefsApplied = true;
    setPrefsBootstrapped(true);
  }, [
    defaultFiltersQuery.data,
    defaultFiltersQuery.isFetched,
    patchFilters,
    ponto,
    prefsBootstrapped,
    savedFiltersQuery.data,
  ]);

  useEffect(() => {
    if (!savedFilterName || !savedFiltersQuery.data) {
      return;
    }
    const found = savedFiltersQuery.data.find((f) => f.nome === savedFilterName);
    if (found) {
      setSavedFilterId(String(found.id));
    }
  }, [savedFilterName, savedFiltersQuery.data]);

  const handleSavedFilterChange = (id: string) => {
    setSavedFilterId(id);
    if (!id) {
      return;
    }
    const filter = savedFiltersQuery.data?.find((f) => String(f.id) === id);
    if (filter) {
      applySavedFilter(filter);
    }
  };

  const clearSavedFilterSelection = () => {
    setSavedFilterId("");
    setSavedFilterName(null);
  };

  const filterStatus = useMemo(() => {
    if (savedFilterName) {
      return (
        <span className="font-semibold text-secondary-blue">
          Filtro: {savedFilterName}
        </span>
      );
    }
    const active = getCotasGrafActiveFilterLabels(filters);
    const implicit = getCotasGrafImplicitFilterHints(filters);
    const textHint = getCotasGrafTextFilterMinLengthHint(filters);
    if (active.length === 0) {
      return (
        <span className="text-neutral-600">
          Sem filtros de formulário
          {textHint ? (
            <span className="text-amber-700"> — {textHint}</span>
          ) : null}
          {implicit.length > 0 ? (
            <span className="text-neutral-500"> ({implicit.join("; ")})</span>
          ) : null}
        </span>
      );
    }
    return (
      <span className="font-semibold text-amber-700">
        Filtro Personalizado: {active.join(", ")}
        {textHint ? (
          <span className="font-normal text-amber-800"> — {textHint}</span>
        ) : null}
        {implicit.length > 0 ? (
          <span className="font-normal text-neutral-500">
            {" "}
            ({implicit.join("; ")})
          </span>
        ) : null}
      </span>
    );
  }, [filters, savedFilterName]);

  const patchFiltersAndClearSaved = (
    patch: Parameters<typeof patchFilters>[0],
  ) => {
    if (
      patch.situacaoCotas !== undefined ||
      patch.nrOs !== undefined ||
      patch.ano !== undefined ||
      patch.anoMode !== undefined ||
      patch.produto !== undefined ||
      patch.produtos !== undefined ||
      patch.titulo !== undefined ||
      patch.solicitante !== undefined ||
      patch.solicitantes !== undefined
    ) {
      setSavedFilterName(null);
      setSavedFilterId("");
    }
    patchFilters(patch);
    if (
      patch.solicitante !== undefined ||
      patch.solicitantes !== undefined
    ) {
      setCotasSolicitanteFilter(null);
    }
  };

  const handleResetFilters = useCallback(() => {
    clearSavedFilterSelection();
    setCotasSolicitanteFilter(null);
    useCotasGrafFiltersStore.getState().resetFilters();
  }, []);

  const handleLaunchRowClick = useCallback((item: CotasGrafItem) => {
    const solicitante = item.solicitante?.trim();
    if (!solicitante) return;
    setCotasSolicitanteFilter((prev) =>
      prev === solicitante ? null : solicitante,
    );
  }, []);

  const handleRefresh = useCallback(async () => {
    setManualRefresh(true);
    try {
      await Promise.all([listQuery.refetch(), solicitantesQuery.refetch()]);
    } finally {
      setManualRefresh(false);
    }
  }, [listQuery, solicitantesQuery]);

  const isListFetching =
    manualRefresh ||
    isTextFilterPending ||
    isChoiceFilterPending ||
    listQuery.isFetching ||
    solicitantesQuery.isFetching;

  const handleLancar = async (item: CotasGrafItem) => {
    const key = `${item.ano}-${item.nr_os}`;
    setPendingKey(key);
    try {
      await lancarMutation.mutateAsync({ ano: item.ano, nrOs: item.nr_os });
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Não foi possível lançar no CotasGraf.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const currentPage = listQuery.data?.page ?? filters.page;
  const pageSize = listQuery.data?.limit ?? filters.limit;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const solicitantesItems = solicitantesQuery.data?.items ?? [];
  const solicitantesTotal = solicitantesQuery.data?.total ?? 0;
  const textMinLengthHint = getCotasGrafTextFilterMinLengthHint(filters);

  const handleLaunchPageChange = useCallback(
    (page: number) => {
      setPage(page);
      launchListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [setPage],
  );

  const renderLaunchRow = (item: CotasGrafItem) => {
    const rowKey = `${item.ano}-${item.nr_os}`;
    const solicitante = item.solicitante?.trim() ?? "";
    const isCotasFilterTarget =
      cotasSolicitanteFilter != null && solicitante === cotasSolicitanteFilter;
    const rowClassName = `hover:bg-slate-50/80 ${
      solicitante ? "cursor-pointer" : ""
    } ${isCotasFilterTarget ? "bg-primary-green/10 ring-1 ring-inset ring-primary-green/30" : ""}`;

    return { rowKey, solicitante, isCotasFilterTarget, rowClassName, item };
  };

  return (
    <div className="flex flex-col gap-4 md:h-full md:min-h-0">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-sagra-border bg-white px-4 py-3 shadow-sm">
        <Coins className="size-8 text-primary-green" />
        <div>
          <h1 className="text-xl font-semibold text-secondary-blue">Cotas Graf</h1>
          <p className="text-sm text-neutral-600">
            OS com requisição — situação Cotas conforme ReqEntregue (pendente / atualizado)
          </p>
        </div>
      </header>

      <CotasGrafFiltersPanel
        onRefresh={() => void handleRefresh()}
        isFetching={isListFetching}
        savedFilters={savedFiltersQuery.data ?? []}
        savedFilterId={savedFilterId}
        onSavedFilterChange={handleSavedFilterChange}
        filterStatus={filterStatus}
        onPatchFilters={patchFiltersAndClearSaved}
        onResetFilters={handleResetFilters}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex flex-col gap-4 xl:flex-row md:min-h-0 md:flex-1">
        <div
          ref={launchListRef}
          className="flex min-w-0 flex-col rounded-lg border border-sagra-border bg-white shadow-sm md:min-h-0 md:flex-[1.4]"
        >
          <div className="border-b border-slate-200 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-secondary-blue">
              Lançamentos CotasGraf
            </h2>
            <p className="text-xs text-neutral-500">
              Situação do lançamento da cota no CotasGraf
              {" · "}
              clique na linha para filtrar cotas do solicitante
            </p>
          </div>

          <div className="md:min-h-0 md:flex-1 md:overflow-auto">
            {!prefsBootstrapped || listQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-neutral-500">
                <Loader2 className="size-5 animate-spin" />
                Carregando lista…
              </div>
            ) : textBelowMinLength ? (
              <div className="p-12 text-center text-amber-700">
                {textMinLengthHint}
              </div>
            ) : listQuery.isError ? (
              <div className="p-12 text-center text-red-600">
                Não foi possível carregar a lista. Tente atualizar a página.
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-neutral-500">
                Nenhum registro encontrado com os filtros atuais.
              </div>
            ) : (
              <>
                <table className="hidden w-full border-collapse text-sm md:table">
                  <thead className="sticky top-0 z-[1] bg-slate-50">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Nr OS
                      </th>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Ano
                      </th>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Produto
                      </th>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Solicitante
                      </th>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Título
                      </th>
                      <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-600">
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const { rowKey, solicitante, isCotasFilterTarget, rowClassName } =
                        renderLaunchRow(item);
                      return (
                        <tr
                          key={rowKey}
                          className={rowClassName}
                          onClick={() => handleLaunchRowClick(item)}
                          onKeyDown={(e) => {
                            if (!solicitante) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleLaunchRowClick(item);
                            }
                          }}
                          tabIndex={solicitante ? 0 : undefined}
                          role={solicitante ? "button" : undefined}
                          aria-pressed={isCotasFilterTarget}
                        >
                          <td className="border-b border-slate-100 px-3 py-2.5 font-medium text-secondary-blue">
                            {formatOsLabel(item.nr_os, item.ano)}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2.5">
                            {item.ano}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2.5 break-words">
                            {item.produto || "—"}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2.5 break-words">
                            {item.solicitante || "—"}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2.5 break-words whitespace-normal">
                            {item.titulo || "—"}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2.5">
                            <CotasGrafActionButton
                              item={item}
                              onLancar={handleLancar}
                              pending={pendingKey === rowKey}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="divide-y divide-slate-100 md:hidden">
                  {items.map((item) => {
                    const { rowKey, solicitante, isCotasFilterTarget, rowClassName } =
                      renderLaunchRow(item);
                    return (
                      <div
                        key={rowKey}
                        className={`px-3 py-3 ${rowClassName}`}
                        onClick={() => handleLaunchRowClick(item)}
                        onKeyDown={(e) => {
                          if (!solicitante) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleLaunchRowClick(item);
                          }
                        }}
                        tabIndex={solicitante ? 0 : undefined}
                        role={solicitante ? "button" : undefined}
                        aria-pressed={isCotasFilterTarget}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-secondary-blue">
                            {formatOsLabel(item.nr_os, item.ano)}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-500">
                            {item.ano}
                          </span>
                        </div>
                        <dl className="mt-2 space-y-1.5 text-sm">
                          <div className="break-words">
                            <dt className="text-xs font-medium text-neutral-500">Produto</dt>
                            <dd>{item.produto || "—"}</dd>
                          </div>
                          <div className="break-words">
                            <dt className="text-xs font-medium text-neutral-500">
                              Solicitante
                            </dt>
                            <dd>{item.solicitante || "—"}</dd>
                          </div>
                          <div className="break-words">
                            <dt className="text-xs font-medium text-neutral-500">Título</dt>
                            <dd>{item.titulo || "—"}</dd>
                          </div>
                        </dl>
                        <div className="mt-3">
                          <CotasGrafActionButton
                            item={item}
                            onLancar={handleLancar}
                            pending={pendingKey === rowKey}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {prefsBootstrapped && !listQuery.isLoading && !listQuery.isError && !textBelowMinLength ? (
            isMobile ? (
              <CotasGrafListPagination
                page={currentPage}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={handleLaunchPageChange}
                itemLabel="registro"
              />
            ) : (
              <p className="border-t border-slate-100 px-3 py-2 text-xs text-neutral-500">
                {items.length} de {total} registro{total !== 1 ? "s" : ""}
              </p>
            )
          ) : null}
        </div>

        <CotasGrafSolicitantesPanel
          items={solicitantesItems}
          total={solicitantesTotal}
          semestreAno={solicitantesQuery.data?.semestre_ano}
          semestreNumero={solicitantesQuery.data?.semestre_numero}
          isLoading={!prefsBootstrapped || solicitantesQuery.isLoading}
          isError={solicitantesQuery.isError}
          textBelowMinLength={textBelowMinLength}
          textMinLengthHint={textMinLengthHint}
          filteredBySolicitante={cotasSolicitanteFilter}
          onClearSolicitanteFilter={() => setCotasSolicitanteFilter(null)}
        />
      </div>

      <CotasGrafSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
