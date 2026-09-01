import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useOsFilterProducts,
  useOsFilterRequesters,
  useOsFilterYears,
} from "@/api/hooks/useOsFilterOptions";
import { useSavedFilters } from "@/api/hooks/useSavedFilters";
import {
  createSavedFilter,
  deleteSavedFilter,
  setDefaultSavedFilter,
  updateSavedFilter,
} from "@/api/settings";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useAuthStore } from "@/features/auth/authStore";
import {
  hasAnySavedFilterCriteria,
  normalizeSavedFilterCriterios,
} from "@/features/os/savedFilterApply";
import { formatProcessoMask } from "@/features/os/processoMask";
import {
  emptySavedFilterCriterios,
  PRIORIDADE_OPTIONS,
  type SavedFilter,
  type SavedFilterCriterios,
} from "@/features/os/types";
import {
  useCategoriasLookup,
  useMaquinasLookup,
  useSetoresLookup,
  useSituacoesLookup,
} from "@/api/hooks/useAuxLookups";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { homeTestIds } from "@/lib/testId";
import { cn } from "@sagra/ui";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  "h-9 w-full rounded border border-sagra-border bg-white px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const [criterios, setCriterios] = useState<SavedFilterCriterios>(
    emptySavedFilterCriterios,
  );
  const [selectedSituacoes, setSelectedSituacoes] = useState<string[]>([]);
  const [selectedSetores, setSelectedSetores] = useState<string[]>([]);
  const [newFilterName, setNewFilterName] = useState("");
  const [editingFilterId, setEditingFilterId] = useState<number | null>(null);

  const [productsOpen, setProductsOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedValue(productSearch, 250);
  const [requestersOpen, setRequestersOpen] = useState(false);
  const [requesterSearch, setRequesterSearch] = useState("");
  const debouncedRequesterSearch = useDebouncedValue(requesterSearch, 250);

  const appliedInitialDefaultRef = useRef(false);

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();
  const categoriasQuery = useCategoriasLookup();
  const maquinasQuery = useMaquinasLookup();
  const yearsQuery = useOsFilterYears(open);
  const productsQuery = useOsFilterProducts(
    debouncedProductSearch,
    open && productsOpen,
  );
  const requestersQuery = useOsFilterRequesters(
    debouncedRequesterSearch,
    open && requestersOpen,
    criterios.categorias,
  );
  const savedFiltersQuery = useSavedFilters(ponto);

  const yearOptions = useMemo(() => {
    const years = yearsQuery.data?.data ?? [];
    return years.map((y) => ({ value: String(y), label: String(y) }));
  }, [yearsQuery.data?.data]);

  const clearEditMode = () => {
    setEditingFilterId(null);
    setNewFilterName("");
  };

  const resetFormFields = () => {
    setCriterios(emptySavedFilterCriterios());
    setSelectedSituacoes([]);
    setSelectedSetores([]);
  };

  const patchCriterios = (patch: Partial<SavedFilterCriterios>) => {
    setCriterios((prev) => ({ ...prev, ...patch }));
  };

  const createFilterMutation = useMutation({
    mutationFn: createSavedFilter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      clearEditMode();
      resetFormFields();
    },
  });

  const updateFilterMutation = useMutation({
    mutationFn: ({
      filterId,
      ...payload
    }: {
      filterId: number;
      nome: string;
      situacoes: string[];
      setores: string[];
      criterios: SavedFilterCriterios;
    }) => updateSavedFilter(filterId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      clearEditMode();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultSavedFilter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: deleteSavedFilter,
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["settings", "savedFilters"] });
      void qc.invalidateQueries({ queryKey: ["settings", "defaultFilters"] });
      if (editingFilterId === deletedId) {
        clearEditMode();
        resetFormFields();
      }
    },
  });

  const loadFilterIntoForm = useCallback((filter: SavedFilter) => {
    setSelectedSituacoes(filter.situacoes ?? []);
    setSelectedSetores(filter.setores ?? []);
    setCriterios(normalizeSavedFilterCriterios(filter.criterios));
  }, []);

  useEffect(() => {
    if (!open) {
      appliedInitialDefaultRef.current = false;
      setEditingFilterId(null);
      setNewFilterName("");
      return;
    }
    if (appliedInitialDefaultRef.current || !savedFiltersQuery.data) {
      return;
    }
    const defaultFilter = savedFiltersQuery.data.find((f) => f.is_default);
    if (defaultFilter && hasAnySavedFilterCriteria(defaultFilter)) {
      loadFilterIntoForm(defaultFilter);
    }
    appliedInitialDefaultRef.current = true;
  }, [loadFilterIntoForm, open, savedFiltersQuery.data]);

  const isBusy =
    createFilterMutation.isPending ||
    updateFilterMutation.isPending ||
    setDefaultMutation.isPending ||
    deleteFilterMutation.isPending;

  const sortedSavedFilters = useMemo(
    () => (savedFiltersQuery.data ?? []).slice(),
    [savedFiltersQuery.data],
  );

  const currentPayload = () => ({
    situacoes: selectedSituacoes,
    setores: selectedSetores,
    criterios: {
      ...criterios,
      processo: criterios.processo.replace(/\D/g, ""),
    },
  });

  const handleCreateFilter = async () => {
    if (!ponto) {
      window.alert("Sessão inválida. Faça login novamente.");
      return;
    }
    const nome = newFilterName.trim();
    if (!nome) {
      window.alert("Digite um nome para o filtro.");
      return;
    }
    try {
      await createFilterMutation.mutateAsync({
        usuario: user?.nome?.trim() || `Usuario_${ponto}`,
        ponto,
        nome,
        ...currentPayload(),
      });
      window.alert("Filtro salvo com sucesso.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar filtro.");
    }
  };

  const handleUpdateFilter = async () => {
    if (editingFilterId == null) return;
    const nome = newFilterName.trim();
    if (!nome) {
      window.alert("Digite um nome para o filtro.");
      return;
    }
    try {
      await updateFilterMutation.mutateAsync({
        filterId: editingFilterId,
        nome,
        ...currentPayload(),
      });
      window.alert("Filtro atualizado com sucesso.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Erro ao atualizar filtro.",
      );
    }
  };

  const handleSetDefault = async (filterId: number) => {
    if (!ponto) return;
    try {
      await setDefaultMutation.mutateAsync({ ponto, filter_id: filterId });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao definir filtro padrão.");
    }
  };

  const handleDeleteFilter = async (filter: SavedFilter) => {
    const ok = window.confirm(`Excluir o filtro "${filter.nome}"?`);
    if (!ok) return;
    try {
      await deleteFilterMutation.mutateAsync(filter.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao excluir filtro.");
    }
  };

  const handleApplyFilter = (filter: SavedFilter) => {
    loadFilterIntoForm(filter);
    setEditingFilterId(filter.id);
    setNewFilterName(filter.nome);
  };

  const handleNewFilter = () => {
    clearEditMode();
    resetFormFields();
  };

  const parseOptionalInt = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
  };

  if (!open) {
    return null;
  }

  const isEditing = editingFilterId != null;
  const anosAsStrings = (criterios.anos ?? []).map(String);
  const disabled = !ponto || isBusy;

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid={homeTestIds.osSettingsRoot}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xl">
        <header className="flex shrink-0 items-start justify-between border-b border-slate-200/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary-green/10 text-primary-green">
              <Settings2 className="size-5" aria-hidden />
            </div>
            <div>
              <h2
                id="settings-modal-title"
                className="text-lg font-bold text-secondary-blue"
              >
                Preferências do sistema
              </h2>
              <p className="text-xs text-slate-500">
                Configure e salve combinações completas de filtros da página inicial.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-800"
            aria-label="Fechar"
            data-testid={homeTestIds.osSettingsClose}
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:flex-nowrap xl:items-stretch xl:gap-0">
            <FilterGroup
              title="Ordem de serviço"
              className="w-auto shrink-0 xl:border-r xl:border-sagra-border xl:pr-4"
            >
              <Field label="Nr OS/Ano" labelWidth="os">
                <div className="flex w-[11.25rem] items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 2244"
                    value={criterios.nr_os != null ? String(criterios.nr_os) : ""}
                    onChange={(e) =>
                      patchCriterios({ nr_os: parseOptionalInt(e.target.value) })
                    }
                    className={cn(inputClass, "min-w-0 flex-[2]")}
                    disabled={disabled}
                    aria-label="Nr OS"
                  />
                  <span className="shrink-0 text-sm font-semibold text-neutral-400" aria-hidden>
                    /
                  </span>
                  <MultiSelect
                    label="Ano"
                    hideLabel
                    aria-label="Ano"
                    className="min-w-0 flex-[3] flex-none"
                    dropdownClassName="min-w-[8rem]"
                    options={yearOptions}
                    value={anosAsStrings}
                    onChange={(vals) =>
                      patchCriterios({
                        anos: vals
                          .map((v) => Number.parseInt(v, 10))
                          .filter((n) => !Number.isNaN(n)),
                      })
                    }
                    disabled={disabled || (yearsQuery.isLoading && yearOptions.length === 0)}
                    placeholder={yearsQuery.isLoading ? "Carregando..." : "Todos"}
                  />
                </div>
              </Field>
              <Field label="Processo" labelWidth="os">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00.000.000/0000"
                  value={criterios.processo ? formatProcessoMask(criterios.processo) : ""}
                  onChange={(e) =>
                    patchCriterios({ processo: formatProcessoMask(e.target.value) })
                  }
                  className={cn(inputClass, "w-[11.25rem] shrink-0")}
                  disabled={disabled}
                />
              </Field>
            </FilterGroup>

            <FilterGroup
              title="Solicitante"
              className="min-w-0 flex-1 xl:border-r xl:border-sagra-border xl:px-4"
            >
              <MultiSelect
                label="Categoria"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                options={categoriasQuery.data ?? []}
                value={criterios.categorias}
                onChange={(categorias) =>
                  patchCriterios({ categorias, solicitantes: [] })
                }
                disabled={disabled || categoriasQuery.isLoading}
              />
              <SearchableMultiSelect
                label="Nome"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                value={criterios.solicitantes}
                onChange={(solicitantes) => patchCriterios({ solicitantes })}
                options={requestersQuery.data?.data ?? []}
                isLoading={requestersQuery.isFetching}
                searchQuery={requesterSearch}
                onSearchChange={setRequesterSearch}
                onOpen={() => setRequestersOpen(true)}
              />
            </FilterGroup>

            <FilterGroup
              title="Dados da OS"
              className="min-w-0 flex-[2] xl:border-r xl:border-sagra-border xl:px-4"
              fieldsClassName="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)]"
            >
              <Field label="Título">
                <input
                  type="text"
                  value={criterios.titulo}
                  onChange={(e) => patchCriterios({ titulo: e.target.value })}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  disabled={disabled}
                />
              </Field>
              <MultiSelect
                label="Máquina"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                options={maquinasQuery.data ?? []}
                value={criterios.maquinas}
                onChange={(maquinas) => patchCriterios({ maquinas })}
                disabled={disabled || maquinasQuery.isLoading}
              />
              <SearchableMultiSelect
                label="Produto"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                value={criterios.produtos}
                onChange={(produtos) => patchCriterios({ produtos })}
                options={productsQuery.data?.data ?? []}
                isLoading={productsQuery.isFetching}
                searchQuery={productSearch}
                onSearchChange={setProductSearch}
                onOpen={() => setProductsOpen(true)}
              />
              <MultiSelect
                label="Prioridade"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                options={PRIORIDADE_OPTIONS}
                value={criterios.prioridade}
                onChange={(prioridade) => patchCriterios({ prioridade })}
                disabled={disabled}
              />
            </FilterGroup>

            <FilterGroup
              title="Andamento"
              className="min-w-0 flex-1 xl:pl-4"
            >
              <MultiSelect
                label="Setor"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                options={setoresQuery.data ?? []}
                value={selectedSetores}
                onChange={setSelectedSetores}
                disabled={disabled || setoresQuery.isLoading}
              />
              <MultiSelect
                label="Situação"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                options={situacoesQuery.data ?? []}
                value={selectedSituacoes}
                onChange={setSelectedSituacoes}
                disabled={disabled || situacoesQuery.isLoading}
              />
            </FilterGroup>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-secondary-blue">Meus filtros</h3>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                placeholder="Nome do filtro"
                className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none ring-primary-green/30 transition focus:ring-2"
                disabled={disabled}
                data-testid={homeTestIds.osSettingsName}
              />
              <button
                type="button"
                onClick={() =>
                  void (isEditing ? handleUpdateFilter() : handleCreateFilter())
                }
                disabled={disabled}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-green px-4 text-sm font-semibold text-white transition hover:bg-primary-green/90 disabled:opacity-60"
                data-testid={homeTestIds.osSettingsSave}
              >
                {isEditing
                  ? updateFilterMutation.isPending
                    ? "Atualizando..."
                    : "Atualizar filtro"
                  : createFilterMutation.isPending
                    ? "Salvando..."
                    : "Salvar filtro atual"}
              </button>
              {isEditing ? (
                <button
                  type="button"
                  onClick={handleNewFilter}
                  disabled={isBusy}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Novo filtro
                </button>
              ) : null}
            </div>

            {savedFiltersQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Carregando filtros...
              </div>
            ) : null}

            {savedFiltersQuery.isError ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {savedFiltersQuery.error instanceof Error
                  ? savedFiltersQuery.error.message
                  : "Erro ao carregar filtros salvos."}
              </p>
            ) : null}

            {!savedFiltersQuery.isPending && !savedFiltersQuery.isError && (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {sortedSavedFilters.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">
                    Nenhum filtro salvo.
                  </p>
                ) : (
                  sortedSavedFilters.map((filter) => (
                    <div
                      key={filter.id}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                        editingFilterId === filter.id
                          ? "border-primary-green bg-primary-green/5"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="radio"
                          name="default-filter"
                          checked={filter.is_default}
                          onChange={() => void handleSetDefault(filter.id)}
                          disabled={isBusy}
                          title="Definir como padrão"
                          className="accent-primary-green"
                          data-testid={homeTestIds.osSettingsDefault}
                        />
                        <button
                          type="button"
                          onClick={() => handleApplyFilter(filter)}
                          className="truncate text-left text-sm font-medium text-slate-700 hover:text-primary-green"
                          title="Editar filtro"
                        >
                          {filter.nome}
                        </button>
                        {filter.is_default ? (
                          <span className="rounded bg-primary-green px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Padrão
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDeleteFilter(filter)}
                        disabled={isBusy}
                        className="inline-flex size-8 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                        title="Excluir filtro"
                        data-testid={homeTestIds.osSettingsDelete}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  children,
  className,
  fieldsClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  fieldsClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <h3 className="text-[0.7rem] font-bold uppercase tracking-wide text-secondary-blue/80">
        {title}
      </h3>
      <div className={cn("flex min-w-0 flex-col gap-2", fieldsClassName)}>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
  labelWidth,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  labelWidth?: "os";
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <label
        className={cn(
          "shrink-0 whitespace-nowrap text-xs font-semibold text-neutral-600",
          labelWidth === "os" && "w-[4.75rem]",
        )}
      >
        {label}:
      </label>
      {children}
    </div>
  );
}
