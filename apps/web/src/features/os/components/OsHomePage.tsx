import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@sagra/ui";

import { useOsFilterYears } from "@/api/hooks/useOsFilterOptions";
import { useOsSearch } from "@/api/hooks/useOsSearch";
import { downloadOsListXlsx, exportOsListXlsx } from "@/api/os";
import {
  useSavedFilters,
  useUserFiltersDefault,
} from "@/api/hooks/useSavedFilters";
import { useAuthStore } from "@/features/auth/authStore";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useGuidedTourStore } from "@/features/guided-tour/tourStore";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { homeTestIds } from "@/lib/testId";
import {
  getActiveFilterValueSummary,
  getImplicitFilterHints,
  getTextFilterMinLengthHint,
  hasTextFilterBelowMinLength,
} from "../filterStatus";
import { useOsActiveSearchStore } from "../osActiveSearchStore";
import { useOsRealtimeSync } from "../hooks/useOsRealtimeSync";
import { isParentOsInSearchResults } from "../osTableRows";
import {
  lastOsSearchRow,
  shouldAutoSelectLastOsRow,
} from "../osHomeListSelection";
import {
  osHomeDetailsPaneClassName,
  osHomeListPaneClassName,
} from "../osHomeListLayout";
import {
  getDefaultYearValue,
  resolveDefaultYear,
} from "../osFilterDefaults";
import {
  applyOsHomeLocalView,
  canUseOsHomeLocalView,
  osHomePatchTriggersFetch,
  toOsHomeDatasetFilters,
} from "../osHomeViewFilters";
import { buildOsHomeSearchFilters } from "../osSearchUtils";
import { sortsToFilterPatch, type OsSortKey } from "../osSortKeys";
import {
  savedFilterToOsPatch,
  userDefaultToOsPatch,
} from "../savedFilterApply";
import { useOsFiltersStore } from "../osFiltersStore";
import { useOsSelectionStore } from "../osSelectionStore";
import type { ProvaFichaCorOptions } from "../utils/requisicaoReportUrl";
import type { OsSearchRow, SavedFilter } from "../types";
import { OsAuditLogModal } from "./OsAuditLogModal";
import { OsDetailsPanel } from "./OsDetailsPanel";
import { OsFiltersPanel } from "./OsFiltersPanel";
import { OsFolderBrowserModal } from "./OsFolderBrowserModal";
import { OsGerenciaDetailModal } from "./OsGerenciaDetailModal";
import { OsHistoryPanel } from "./OsHistoryPanel";
import { OsMoverPastasModal } from "./OsMoverPastasModal";
import { OsOrdersTable } from "./OsOrdersTable";
import { OsPrintFichaModal } from "./OsPrintFichaModal";
import { OsPrintModeModal } from "./OsPrintModeModal";
import { OsSeparadorModal } from "./OsSeparadorModal";
import { SettingsModal } from "@/features/settings/components/SettingsModal";
import { OsVincularModal } from "./OsVincularModal";
import { OsNotificarModal } from "./OsNotificarModal";
import { OsSaveCurrentFiltersModal } from "./OsSaveCurrentFiltersModal";

/** Sobrevive à navegação SPA; zera no refresh (novo carregamento do módulo). */
let homeDefaultPrefsApplied = false;
let homeSavedFilterId = "";
let homeSavedFilterName: string | null = null;

export function OsHomePage() {
  const user = useAuthStore((s) => s.user);
  const { can } = useAccessControl();
  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const filters = useOsFiltersStore((s) => s.filters);
  const patchFilters = useOsFiltersStore((s) => s.patchFilters);

  const selected = useOsSelectionStore((s) => s.selected);
  const setSelected = useOsSelectionStore((s) => s.setSelected);

  const [savedFilterId, setSavedFilterId] = useState(homeSavedFilterId);
  const [savedFilterName, setSavedFilterName] = useState<string | null>(
    homeSavedFilterName,
  );
  const [historyEditing, setHistoryEditing] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [userListFetchPending, setUserListFetchPending] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [gerenciaDetailOpen, setGerenciaDetailOpen] = useState(false);
  const [printModePickerOpen, setPrintModePickerOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState<
    "normal" | "prova" | "prova_ficha"
  >("normal");
  const [provaCorOptions, setProvaCorOptions] = useState<
    ProvaFichaCorOptions | undefined
  >(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveFiltersOpen, setSaveFiltersOpen] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [moverPastasOpen, setMoverPastasOpen] = useState(false);
  const [notificarOpen, setNotificarOpen] = useState(false);
  const [separadorOpen, setSeparadorOpen] = useState(false);
  const [mobileView, setMobileView] = useState<
    "list" | "details" | "history"
  >("list");
  const [listExpanded, setListExpanded] = useState(false);
  const requestedMobileView = useGuidedTourStore((s) => s.requestedMobileView);
  const [prefsBootstrapped, setPrefsBootstrapped] = useState(homeDefaultPrefsApplied);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const lastAutoKeyRef = useRef<string | null>(null);

  useEffect(() => {
    homeSavedFilterId = savedFilterId;
    homeSavedFilterName = savedFilterName;
  }, [savedFilterId, savedFilterName]);

  useEffect(() => {
    if (!requestedMobileView) {
      return;
    }
    setMobileView(requestedMobileView);
  }, [requestedMobileView]);

  const debouncedNrOs = useDebouncedValue(filters.nrOs, 200);
  const debouncedTitulo = useDebouncedValue(filters.titulo, 450);
  const debouncedProcesso = useDebouncedValue(filters.processo, 450);
  const debouncedPapel = useDebouncedValue(filters.papel, 450);
  const debouncedCores = useDebouncedValue(filters.cores, 450);
  const debouncedAcabamento = useDebouncedValue(filters.acabamento, 450);
  const debouncedObservacao = useDebouncedValue(filters.observacao, 450);

  const debouncedDatasetChoices = useDebouncedValue(
    {
      situacao: filters.situacao,
      setor: filters.setor,
      prioridade: filters.prioridade,
      categorias: filters.categorias,
      maquinas: filters.maquinas,
      anos: filters.anos,
    },
    200,
  );

  const localViewPending = canUseOsHomeLocalView({
    ...filters,
    anos: debouncedDatasetChoices.anos,
  });

  const debouncedTextFilters = useMemo(
    () =>
      localViewPending
        ? {
            nrOs: filters.nrOs,
            titulo: filters.titulo,
            processo: debouncedProcesso,
            papel: debouncedPapel,
            cores: debouncedCores,
            acabamento: debouncedAcabamento,
            observacao: debouncedObservacao,
          }
        : {
            nrOs: debouncedNrOs,
            titulo: debouncedTitulo,
            processo: debouncedProcesso,
            papel: debouncedPapel,
            cores: debouncedCores,
            acabamento: debouncedAcabamento,
            observacao: debouncedObservacao,
          },
    [
      debouncedAcabamento,
      debouncedCores,
      debouncedNrOs,
      debouncedObservacao,
      debouncedPapel,
      debouncedProcesso,
      debouncedTitulo,
      filters.nrOs,
      filters.titulo,
      localViewPending,
    ],
  );

  const searchFilters = useMemo(
    () => ({
      ...buildOsHomeSearchFilters(
        {
          ...filters,
          situacao: localViewPending
            ? filters.situacao
            : debouncedDatasetChoices.situacao,
          setor: localViewPending
            ? filters.setor
            : debouncedDatasetChoices.setor,
          prioridade: localViewPending
            ? filters.prioridade
            : debouncedDatasetChoices.prioridade,
          categorias: debouncedDatasetChoices.categorias,
          maquinas: debouncedDatasetChoices.maquinas,
          anos: debouncedDatasetChoices.anos,
        },
        debouncedTextFilters,
      ),
      fetchAll: true as const,
    }),
    [debouncedDatasetChoices, debouncedTextFilters, filters, localViewPending],
  );

  const datasetFilters = useMemo(
    () => ({ ...toOsHomeDatasetFilters(searchFilters), fetchAll: true as const }),
    [searchFilters],
  );

  const textBelowMinLength = useMemo(
    () => hasTextFilterBelowMinLength(filters),
    [filters],
  );

  const isTextFilterPending = useMemo(() => {
    const processoPending = filters.processo !== debouncedProcesso;
    const extraTextPending =
      filters.papel !== debouncedPapel ||
      filters.cores !== debouncedCores ||
      filters.acabamento !== debouncedAcabamento ||
      filters.observacao !== debouncedObservacao;
    if (localViewPending) {
      return (
        processoPending || (!textBelowMinLength && extraTextPending)
      );
    }
    return (
      !textBelowMinLength &&
      (filters.nrOs !== debouncedNrOs ||
        filters.titulo !== debouncedTitulo ||
        processoPending ||
        extraTextPending)
    );
  }, [
    debouncedAcabamento,
    debouncedCores,
    debouncedNrOs,
    debouncedObservacao,
    debouncedPapel,
    debouncedProcesso,
    debouncedTitulo,
    filters,
    localViewPending,
    textBelowMinLength,
  ]);

  const isChoiceFilterPending = useMemo(
    () =>
      filters.categorias !== debouncedDatasetChoices.categorias ||
      filters.maquinas !== debouncedDatasetChoices.maquinas ||
      filters.anos !== debouncedDatasetChoices.anos ||
      (!localViewPending &&
        (filters.situacao !== debouncedDatasetChoices.situacao ||
          filters.setor !== debouncedDatasetChoices.setor ||
          filters.prioridade !== debouncedDatasetChoices.prioridade)),
    [debouncedDatasetChoices, filters, localViewPending],
  );

  const searchQuery = useOsSearch(datasetFilters, prefsBootstrapped);
  const registerActiveSearch = useOsActiveSearchStore((s) => s.register);
  const clearActiveSearch = useOsActiveSearchStore((s) => s.clear);

  useLayoutEffect(() => {
    if (!prefsBootstrapped) {
      clearActiveSearch();
      return;
    }
    registerActiveSearch(datasetFilters, () => searchQuery.refetch());
    return () => clearActiveSearch();
  }, [
    clearActiveSearch,
    datasetFilters,
    prefsBootstrapped,
    registerActiveSearch,
    searchQuery.refetch,
  ]);

  useEffect(() => {
    console.info("[OS LIST] os-active-search-refetch-v20250610");
  }, []);

  const savedFiltersQuery = useSavedFilters(ponto);
  const defaultFiltersQuery = useUserFiltersDefault(ponto);
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
    const preferred = getDefaultYearValue();
    const currentAnos = filters.anos ?? [];
    if (currentAnos.length !== 1 || currentAnos[0] !== preferred) {
      defaultYearAdjusted.current = true;
      return;
    }
    const resolved = resolveDefaultYear(preferred, years);
    if (resolved != null && resolved !== preferred) {
      patchFilters({ anos: [resolved], page: 1 });
    }
    defaultYearAdjusted.current = true;
  }, [filters.anos, patchFilters, prefsBootstrapped, yearsQuery.data]);

  const localView = useMemo(() => {
    const raw = searchQuery.data?.data ?? [];
    return applyOsHomeLocalView(raw, searchFilters);
  }, [searchFilters, searchQuery.data]);

  const rows = localView.rows;
  const meta = useMemo(() => {
    const base = searchQuery.data?.meta;
    if (!base) {
      return undefined;
    }
    if (localView.totalRecords == null) {
      return base;
    }
    return {
      ...base,
      total_records: localView.totalRecords,
      total_pages: localView.totalRecords ? 1 : 0,
    };
  }, [localView.totalRecords, searchQuery.data?.meta]);

  const markUserListFetch = useCallback(() => {
    setUserListFetchPending(true);
  }, []);

  useEffect(() => {
    if (!searchQuery.isFetching && !isTextFilterPending) {
      setUserListFetchPending(false);
    }
  }, [searchQuery.isFetching, isTextFilterPending]);

  const isListFetching =
    manualRefresh ||
    isTextFilterPending ||
    isChoiceFilterPending ||
    (userListFetchPending && searchQuery.isFetching);

  const handleRefresh = useCallback(async () => {
    setManualRefresh(true);
    const REFRESH_TIMEOUT_MS = 30_000;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        searchQuery.refetch().then(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, REFRESH_TIMEOUT_MS);
        }),
      ]);
      if (timedOut) {
        window.alert(
          "A atualização da lista está demorando. Tente novamente em alguns segundos.",
        );
      }
    } catch (err) {
      window.alert(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar a lista de OSs.",
      );
    } finally {
      if (timer != null) {
        clearTimeout(timer);
      }
      setManualRefresh(false);
    }
  }, [searchQuery]);

  const applySavedFilter = useCallback(
    (filter: SavedFilter) => {
      const patch = savedFilterToOsPatch(filter);
      if (osHomePatchTriggersFetch(patch, filters)) {
        markUserListFetch();
      }
      patchFilters(patch);
      setSavedFilterId(String(filter.id));
      setSavedFilterName(filter.nome);
    },
    [filters, markUserListFetch, patchFilters],
  );

  useEffect(() => {
    if (homeDefaultPrefsApplied || prefsBootstrapped) {
      return;
    }
    if (!ponto) {
      homeDefaultPrefsApplied = true;
      setPrefsBootstrapped(true);
      return;
    }
    if (!defaultFiltersQuery.isFetched) {
      return;
    }

    const data = defaultFiltersQuery.data;
    if (data) {
      const patch = userDefaultToOsPatch(data);
      if (patch) {
        patchFilters(patch);
      }
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
    homeDefaultPrefsApplied = true;
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

  const titleStatus = useMemo(() => {
    if (savedFilterName) {
      return (
        <span className="font-semibold text-secondary-blue">
          Filtros de Pesquisa: {savedFilterName}
        </span>
      );
    }
    const values = getActiveFilterValueSummary(filters);
    const implicit = getImplicitFilterHints(filters);
    const textHint = getTextFilterMinLengthHint(filters);
    if (values.length === 0) {
      return (
        <span className="text-secondary-blue">
          Filtros de Pesquisa
          {textHint ? (
            <span className="font-normal text-amber-700"> — {textHint}</span>
          ) : null}
          {implicit.length > 0 ? (
            <span className="font-normal text-neutral-500">
              {" "}
              ({implicit.join("; ")})
            </span>
          ) : null}
        </span>
      );
    }
    return (
      <span className="font-semibold text-secondary-blue">
        Filtros de Pesquisa:{" "}
        <span className="font-semibold text-amber-700">
          {values.join(", ")}
        </span>
        {textHint ? (
          <span className="font-normal text-amber-800"> — {textHint}</span>
        ) : null}
        {implicit.length > 0 ? (
          <span className="font-normal text-neutral-500">
            {" "}
            — {implicit.join("; ")}
          </span>
        ) : null}
      </span>
    );
  }, [filters, savedFilterName]);

  useOsRealtimeSync({
    filters: datasetFilters,
  });

  const patchFiltersAndClearSaved = (patch: Parameters<typeof patchFilters>[0]) => {
    if (
      patch.situacao !== undefined ||
      patch.setor !== undefined ||
      patch.prioridade !== undefined ||
      patch.nrOs !== undefined ||
      patch.anos !== undefined ||
      patch.ano !== undefined ||
      patch.anoMode !== undefined ||
      patch.produto !== undefined ||
      patch.produtos !== undefined ||
      patch.titulo !== undefined ||
      patch.processo !== undefined ||
      patch.solicitante !== undefined ||
      patch.solicitantes !== undefined ||
      patch.categorias !== undefined ||
      patch.maquinas !== undefined ||
      patch.formatos !== undefined ||
      patch.papel !== undefined ||
      patch.cores !== undefined ||
      patch.acabamento !== undefined ||
      patch.observacao !== undefined ||
      patch.dataEntradaDe !== undefined ||
      patch.dataEntradaAte !== undefined
    ) {
      setSavedFilterName(null);
      setSavedFilterId("");
    }
    if (osHomePatchTriggersFetch(patch, filters)) {
      markUserListFetch();
    }
    patchFilters(patch);
  };

  const handleResetFilters = useCallback(() => {
    markUserListFetch();
    clearSavedFilterSelection();
    setSelected(null);
    useOsFiltersStore.getState().resetFilters();
  }, [markUserListFetch, setSelected]);

  /** Limpa seleção só se a OS principal saiu da lista (Sub OS permanece enquanto o pai existir). */
  useEffect(() => {
    if (!selected) {
      return;
    }
    if (!isParentOsInSearchResults(selected, rows)) {
      setSelected(null);
    }
  }, [rows, selected, setSelected]);

  useEffect(() => {
    const last = lastOsSearchRow(rows);
    const effectiveSelected =
      selected && isParentOsInSearchResults(selected, rows) ? selected : null;
    const decision = shouldAutoSelectLastOsRow({
      lastRow: last,
      selected: effectiveSelected,
      lastAutoKey: lastAutoKeyRef.current,
      editing: historyEditing,
    });
    if (!decision) {
      return;
    }
    lastAutoKeyRef.current = decision.nextAutoKey;
    setSelected(decision.select);
  }, [historyEditing, rows, selected, setSelected]);

  useEffect(() => {
    if (!selected) {
      setMobileView("list");
      return;
    }
    setMobileView("details");
  }, [selected]);

  const handleSortChange = useCallback(
    (sorts: OsSortKey[]) => {
      const patch = { ...sortsToFilterPatch(sorts), page: 1 as const };
      if (osHomePatchTriggersFetch(patch, filters)) {
        markUserListFetch();
      }
      patchFilters(patch);
    },
    [filters, markUserListFetch, patchFilters],
  );

  const handleOpenGerenciaDetail = useCallback(
    (row: OsSearchRow) => {
      if (!can("ctx_detalhes_os") && !can("ctx_editar_os")) {
        return;
      }
      const target: OsSearchRow =
        row.is_sub_os || row.kind === "sub_os"
          ? {
              ...row,
              nr_os: row.parent_nr_os ?? row.nr_os,
              ano: row.parent_ano ?? row.ano,
              is_sub_os: undefined,
              kind: "main_os",
              parent_nr_os: undefined,
              parent_ano: undefined,
              sub_os_id: undefined,
              componente_nome: undefined,
              display_label: undefined,
            }
          : row;
      setSelected(target);
      setGerenciaDetailOpen(true);
    },
    [can, setSelected],
  );

  const handleExportReport = useCallback(async () => {
    if (textBelowMinLength) {
      window.alert(
        getTextFilterMinLengthHint(filters) ??
          "Complete os filtros de texto antes de exportar.",
      );
      return;
    }
    setIsExportingReport(true);
    try {
      const blob = await exportOsListXlsx(searchFilters);
      downloadOsListXlsx(blob);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Falha ao gerar relatório.",
      );
    } finally {
      setIsExportingReport(false);
    }
  }, [filters, searchFilters, textBelowMinLength]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:h-full md:overflow-hidden">

      <OsFiltersPanel
        onRefresh={handleRefresh}
        isFetching={isListFetching}
        savedFilters={savedFiltersQuery.data ?? []}
        savedFilterId={savedFilterId}
        onSavedFilterChange={handleSavedFilterChange}
        titleStatus={titleStatus}
        onPatchFilters={patchFiltersAndClearSaved}
        onResetFilters={handleResetFilters}
        onOpenSettings={
          can("sb_configuracoes")
            ? () => setSettingsOpen(true)
            : undefined
        }
        onSaveCurrentFilters={
          can("sb_configuracoes")
            ? () => setSaveFiltersOpen(true)
            : undefined
        }
      />

      <div className="flex min-h-min flex-1 flex-col gap-2 md:min-h-0 md:overflow-hidden">
        {selected ? (
          <div
            className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm lg:hidden"
            role="tablist"
            aria-label="Alternar lista, detalhes e andamentos"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === "list"}
              onClick={() => setMobileView("list")}
              data-testid={homeTestIds.osTabLista}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[0.65rem] font-semibold transition-colors sm:px-3 sm:text-xs",
                mobileView === "list"
                  ? "bg-secondary-blue text-white"
                  : "text-neutral-600 hover:bg-slate-50",
              )}
            >
              Lista de OS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === "details"}
              onClick={() => setMobileView("details")}
              data-testid={homeTestIds.osTabDetalhes}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[0.65rem] font-semibold transition-colors sm:px-3 sm:text-xs",
                mobileView === "details"
                  ? "bg-secondary-blue text-white"
                  : "text-neutral-600 hover:bg-slate-50",
              )}
            >
              Detalhes
            </button>
            <button
              type="button"
              role="tab"
              data-tour="os-mobile-history-tab"
              data-testid={homeTestIds.osTabAndamentos}
              aria-selected={mobileView === "history"}
              onClick={() => setMobileView("history")}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[0.65rem] font-semibold transition-colors sm:px-3 sm:text-xs",
                mobileView === "history"
                  ? "bg-secondary-blue text-white"
                  : "text-neutral-600 hover:bg-slate-50",
              )}
            >
              Andamentos
            </button>
          </div>
        ) : null}

        <div
          className={osHomeListPaneClassName(
            listExpanded,
            mobileView,
          )}
        >
          <OsOrdersTable
            rows={rows}
            meta={meta}
            isLoading={!prefsBootstrapped || searchQuery.isLoading}
            isFetching={isListFetching}
            isError={searchQuery.isError}
            errorMessage={
              searchQuery.error instanceof Error
                ? searchQuery.error.message
                : undefined
            }
            selectedRow={selected}
            onSelectRow={setSelected}
            selectionLocked={historyEditing}
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            sorts={filters.sorts}
            onSortChange={handleSortChange}
            onExportReport={() => void handleExportReport()}
            isExporting={isExportingReport}
            exportDisabled={!prefsBootstrapped || textBelowMinLength}
            onOpenGerenciaDetail={handleOpenGerenciaDetail}
            listExpanded={listExpanded}
            onListExpandedChange={setListExpanded}
          />
        </div>

        <section
          id={homeTestIds.osHomeDetailsHistory}
          data-testid={homeTestIds.osHomeDetailsHistory}
          className={osHomeDetailsPaneClassName(listExpanded, mobileView)}
          aria-label="Detalhes e histórico da OS"
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border border-t-4 border-t-secondary-blue bg-white shadow-sm",
              mobileView === "history" && "hidden lg:flex",
            )}
          >
            <OsDetailsPanel
              key={
                selected
                  ? `details-${selected.ano}-${selected.nr_os}`
                  : "details-none"
              }
              selected={selected}
              embedded
            />
          </div>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border border-t-4 border-t-secondary-blue bg-white shadow-sm",
              mobileView === "details" && "hidden lg:flex",
            )}
          >
            <OsHistoryPanel
              key={
                selected
                  ? `history-${selected.ano}-${selected.nr_os}`
                  : "history-none"
              }
              selected={selected}
              embedded
              onEditingChange={setHistoryEditing}
            />
          </div>
        </section>
      </div>

      <OsVincularModal
        row={selected}
        open={vincularOpen}
        onClose={() => setVincularOpen(false)}
      />

      <OsAuditLogModal
        row={selected}
        open={auditLogOpen}
        onClose={() => setAuditLogOpen(false)}
      />

      {gerenciaDetailOpen ? (
        <OsGerenciaDetailModal
          row={selected}
          open={gerenciaDetailOpen}
          onClose={() => setGerenciaDetailOpen(false)}
        />
      ) : null}

      <OsPrintModeModal
        open={printModePickerOpen}
        osLabel={
          selected ? `${selected.nr_os}/${selected.ano}` : undefined
        }
        onClose={() => setPrintModePickerOpen(false)}
        onSelect={(mode, provaCor) => {
          setPrintMode(mode);
          setProvaCorOptions(mode === "prova_ficha" ? provaCor : undefined);
          setPrintModePickerOpen(false);
          setPrintOpen(true);
        }}
      />

      <OsPrintFichaModal
        row={selected}
        open={printOpen}
        mode={printMode}
        provaCor={provaCorOptions}
        onClose={() => {
          setPrintOpen(false);
          setProvaCorOptions(undefined);
        }}
      />

      <OsFolderBrowserModal
        row={selected}
        open={folderBrowserOpen}
        onClose={() => setFolderBrowserOpen(false)}
      />

      <OsMoverPastasModal
        row={selected}
        open={moverPastasOpen}
        onClose={() => setMoverPastasOpen(false)}
      />

      <OsNotificarModal
        row={selected}
        open={notificarOpen}
        onClose={() => setNotificarOpen(false)}
      />

      <OsSeparadorModal
        row={selected}
        open={separadorOpen}
        onClose={() => setSeparadorOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <OsSaveCurrentFiltersModal
        open={saveFiltersOpen}
        onClose={() => setSaveFiltersOpen(false)}
        onSaved={(nome) => setSavedFilterName(nome)}
      />

      {/* Expõe abertura de modais para o menu de contexto via eventos customizados */}
      <OsHomeModalsBridge
        onVincular={() => setVincularOpen(true)}
        onAuditLog={() => setAuditLogOpen(true)}
        onFolderBrowser={() => setFolderBrowserOpen(true)}
        onMoverPastas={() => setMoverPastasOpen(true)}
        onPrintPicker={() => {
          if (!selected) {
            window.alert("Selecione uma OS.");
            return;
          }
          setPrintModePickerOpen(true);
        }}
        onNotificar={() => setNotificarOpen(true)}
        onSeparador={() => {
          if (!selected) {
            window.alert("Selecione uma OS.");
            return;
          }
          setSeparadorOpen(true);
        }}
      />
    </div>
  );
}

/** Permite ao menu de contexto abrir modais sem acoplar props profundas. */
function OsHomeModalsBridge({
  onVincular,
  onAuditLog,
  onFolderBrowser,
  onMoverPastas,
  onPrintPicker,
  onNotificar,
  onSeparador,
}: {
  onVincular: () => void;
  onAuditLog: () => void;
  onFolderBrowser: () => void;
  onMoverPastas: () => void;
  onPrintPicker: () => void;
  onNotificar: () => void;
  onSeparador: () => void;
}) {
  useEffect(() => {
    const onVinc = () => onVincular();
    const onAudit = () => onAuditLog();
    const onFolder = () => onFolderBrowser();
    const onMove = () => onMoverPastas();
    const onPrintPickerEvent = () => onPrintPicker();
    const onNotificarEvent = () => onNotificar();
    const onSeparadorEvent = () => onSeparador();
    window.addEventListener("sagra:os-vincular", onVinc);
    window.addEventListener("sagra:os-audit-log", onAudit);
    window.addEventListener("sagra:os-folder-browser", onFolder);
    window.addEventListener("sagra:os-mover-pastas", onMove);
    window.addEventListener("sagra:os-print-ficha", onPrintPickerEvent);
    window.addEventListener("sagra:os-notificar", onNotificarEvent);
    window.addEventListener("sagra:os-separador", onSeparadorEvent);
    return () => {
      window.removeEventListener("sagra:os-vincular", onVinc);
      window.removeEventListener("sagra:os-audit-log", onAudit);
      window.removeEventListener("sagra:os-folder-browser", onFolder);
      window.removeEventListener("sagra:os-mover-pastas", onMove);
      window.removeEventListener("sagra:os-print-ficha", onPrintPickerEvent);
      window.removeEventListener("sagra:os-notificar", onNotificarEvent);
      window.removeEventListener("sagra:os-separador", onSeparadorEvent);
    };
  }, [
    onAuditLog,
    onFolderBrowser,
    onMoverPastas,
    onNotificar,
    onPrintPicker,
    onSeparador,
    onVincular,
  ]);
  return null;
}
