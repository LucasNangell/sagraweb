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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
  getDefaultYearValue,
  resolveDefaultYear,
} from "../osFilterDefaults";
import { buildOsHomeSearchFilters } from "../osSearchUtils";
import {
  savedFilterToOsPatch,
  userDefaultToOsPatch,
} from "../savedFilterApply";
import { useOsFiltersStore } from "../osFiltersStore";
import { useOsSelectionStore } from "../osSelectionStore";
import type { ProvaFichaCorOptions } from "../utils/requisicaoReportUrl";
import type { OsSearchRow, OsSortColumn, OsSortDir, SavedFilter } from "../types";
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
import { SettingsModal } from "@/features/settings/components/SettingsModal";
import { OsVincularModal } from "./OsVincularModal";
import { OsNotificarModal } from "./OsNotificarModal";

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
  const setPage = useOsFiltersStore((s) => s.setPage);

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
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [moverPastasOpen, setMoverPastasOpen] = useState(false);
  const [notificarOpen, setNotificarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<
    "list" | "details" | "history"
  >("list");
  const [prefsBootstrapped, setPrefsBootstrapped] = useState(homeDefaultPrefsApplied);
  const [isExportingReport, setIsExportingReport] = useState(false);

  useEffect(() => {
    homeSavedFilterId = savedFilterId;
    homeSavedFilterName = savedFilterName;
  }, [savedFilterId, savedFilterName]);

  const debouncedNrOs = useDebouncedValue(filters.nrOs, 200);
  const debouncedTitulo = useDebouncedValue(filters.titulo, 450);
  const debouncedProcesso = useDebouncedValue(filters.processo, 450);

  const debouncedChoiceFilters = useDebouncedValue(
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

  const debouncedTextFilters = useMemo(
    () => ({
      nrOs: debouncedNrOs,
      titulo: debouncedTitulo,
      processo: debouncedProcesso,
    }),
    [debouncedNrOs, debouncedTitulo, debouncedProcesso],
  );

  const searchFilters = useMemo(
    () =>
      buildOsHomeSearchFilters(
        {
          ...filters,
          situacao: debouncedChoiceFilters.situacao,
          setor: debouncedChoiceFilters.setor,
          prioridade: debouncedChoiceFilters.prioridade,
          categorias: debouncedChoiceFilters.categorias,
          maquinas: debouncedChoiceFilters.maquinas,
          anos: debouncedChoiceFilters.anos,
        },
        debouncedTextFilters,
      ),
    [debouncedChoiceFilters, debouncedTextFilters, filters],
  );

  const textBelowMinLength = useMemo(
    () => hasTextFilterBelowMinLength(filters),
    [filters],
  );

  const isTextFilterPending = useMemo(
    () =>
      !textBelowMinLength &&
      (filters.nrOs !== debouncedNrOs ||
        filters.titulo !== debouncedTitulo ||
        filters.processo !== debouncedProcesso),
    [
      debouncedNrOs,
      debouncedTitulo,
      debouncedProcesso,
      filters,
      textBelowMinLength,
    ],
  );

  const isChoiceFilterPending = useMemo(
    () =>
      filters.situacao !== debouncedChoiceFilters.situacao ||
      filters.setor !== debouncedChoiceFilters.setor ||
      filters.prioridade !== debouncedChoiceFilters.prioridade ||
      filters.categorias !== debouncedChoiceFilters.categorias ||
      filters.maquinas !== debouncedChoiceFilters.maquinas ||
      filters.anos !== debouncedChoiceFilters.anos,
    [debouncedChoiceFilters, filters],
  );

  const searchQuery = useOsSearch(searchFilters, prefsBootstrapped);
  const registerActiveSearch = useOsActiveSearchStore((s) => s.register);
  const clearActiveSearch = useOsActiveSearchStore((s) => s.clear);

  useLayoutEffect(() => {
    if (!prefsBootstrapped) {
      clearActiveSearch();
      return;
    }
    registerActiveSearch(searchFilters, () => searchQuery.refetch());
    return () => clearActiveSearch();
  }, [
    clearActiveSearch,
    prefsBootstrapped,
    registerActiveSearch,
    searchFilters,
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

  const rows = searchQuery.data?.data ?? [];
  const meta = searchQuery.data?.meta;
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
      markUserListFetch();
      patchFilters(savedFilterToOsPatch(filter));
      setSavedFilterId(String(filter.id));
      setSavedFilterName(filter.nome);
    },
    [markUserListFetch, patchFilters],
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
    filters: searchFilters,
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
      patch.maquinas !== undefined
    ) {
      setSavedFilterName(null);
      setSavedFilterId("");
    }
    markUserListFetch();
    patchFilters(patch);
  };

  const handleResetFilters = useCallback(() => {
    markUserListFetch();
    clearSavedFilterSelection();
    setSelected(null);
    useOsFiltersStore.getState().resetFilters();
  }, [markUserListFetch, setSelected]);

  const handlePageChange = useCallback(
    (page: number) => {
      markUserListFetch();
      setPage(page);
    },
    [markUserListFetch, setPage],
  );

  const handlePageSizeChange = useCallback(
    (limit: number) => {
      if (limit === filters.limit) {
        return;
      }
      markUserListFetch();
      patchFilters({ limit, page: 1 });
    },
    [filters.limit, markUserListFetch, patchFilters],
  );

  /** Limpa seleção só se a OS principal saiu da página (Sub OS permanece enquanto o pai existir). */
  useEffect(() => {
    if (!selected) {
      return;
    }
    if (!isParentOsInSearchResults(selected, rows)) {
      setSelected(null);
    }
  }, [rows, selected, setSelected]);

  useEffect(() => {
    if (!selected) {
      setMobileView("list");
      return;
    }
    setMobileView("details");
  }, [selected]);

  const handleSortChange = useCallback(
    (sortBy?: OsSortColumn, sortDir?: OsSortDir) => {
      markUserListFetch();
      patchFilters({ sortBy, sortDir, page: 1 });
    },
    [markUserListFetch, patchFilters],
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
    <div className="flex min-h-min flex-1 flex-col gap-2 md:h-full md:min-h-0 md:overflow-hidden">

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
          className={cn(
            "min-h-[min(50vh,360px)] flex-none md:min-h-[clamp(160px,32vh,360px)] md:flex-[5] md:overflow-hidden lg:min-h-[180px]",
            mobileView !== "list" ? "hidden lg:block" : "block",
          )}
        >
          <OsOrdersTable
            rows={rows}
            meta={meta}
            currentPage={filters.page}
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
            onPageChange={handlePageChange}
            pageSize={filters.limit}
            onPageSizeChange={handlePageSizeChange}
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            onSortChange={handleSortChange}
            onExportReport={() => void handleExportReport()}
            isExporting={isExportingReport}
            exportDisabled={!prefsBootstrapped || textBelowMinLength}
            onOpenGerenciaDetail={handleOpenGerenciaDetail}
          />
        </div>

        <section
          className={cn(
            "flex min-h-0 flex-col gap-2 md:grid md:grid-cols-1 md:gap-2 lg:grid-cols-2 lg:gap-3",
            mobileView === "list"
              ? "hidden lg:grid lg:flex-none lg:min-h-[220px] lg:overflow-hidden md:min-h-[clamp(200px,38vh,420px)] md:flex-[4]"
              : "min-h-0 flex-1 overflow-hidden md:flex-none md:min-h-[clamp(200px,38vh,420px)] md:flex-[4] lg:min-h-[220px] lg:overflow-hidden",
          )}
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
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
}: {
  onVincular: () => void;
  onAuditLog: () => void;
  onFolderBrowser: () => void;
  onMoverPastas: () => void;
  onPrintPicker: () => void;
  onNotificar: () => void;
}) {
  useEffect(() => {
    const onVinc = () => onVincular();
    const onAudit = () => onAuditLog();
    const onFolder = () => onFolderBrowser();
    const onMove = () => onMoverPastas();
    const onPrintPickerEvent = () => onPrintPicker();
    const onNotificarEvent = () => onNotificar();
    window.addEventListener("sagra:os-vincular", onVinc);
    window.addEventListener("sagra:os-audit-log", onAudit);
    window.addEventListener("sagra:os-folder-browser", onFolder);
    window.addEventListener("sagra:os-mover-pastas", onMove);
    window.addEventListener("sagra:os-print-ficha", onPrintPickerEvent);
    window.addEventListener("sagra:os-notificar", onNotificarEvent);
    return () => {
      window.removeEventListener("sagra:os-vincular", onVinc);
      window.removeEventListener("sagra:os-audit-log", onAudit);
      window.removeEventListener("sagra:os-folder-browser", onFolder);
      window.removeEventListener("sagra:os-mover-pastas", onMove);
      window.removeEventListener("sagra:os-print-ficha", onPrintPickerEvent);
      window.removeEventListener("sagra:os-notificar", onNotificarEvent);
    };
  }, [onAuditLog, onFolderBrowser, onMoverPastas, onNotificar, onPrintPicker, onVincular]);
  return null;
}
