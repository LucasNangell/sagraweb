import { cn } from "@sagra/ui";
import { ChevronDown, ChevronUp, Eraser, Filter, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  useOsFilterFormatos,
  useOsFilterProducts,
  useOsFilterRequesters,
  useOsFilterYears,
} from "@/api/hooks/useOsFilterOptions";
import {
  useCategoriasLookup,
  useMaquinasLookup,
  useSetoresLookup,
  useSituacoesLookup,
} from "@/api/hooks/useAuxLookups";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { homeTestIds } from "@/lib/testId";
import { hasOsHomeAdvancedFilters } from "../osSearchUtils";
import { useOsFiltersStore } from "../osFiltersStore";
import { formatProcessoMask } from "../processoMask";
import { PRIORIDADE_OPTIONS } from "../types";
import type { OsSearchFilters, SavedFilter } from "../types";

interface OsFiltersPanelProps {
  onRefresh: () => void;
  isFetching?: boolean;
  savedFilters: SavedFilter[];
  savedFilterId: string;
  onSavedFilterChange: (id: string) => void;
  titleStatus: ReactNode;
  onPatchFilters: (patch: Partial<OsSearchFilters>) => void;
  onResetFilters: () => void;
  onOpenSettings?: () => void;
}

export function OsFiltersPanel({
  onRefresh,
  isFetching,
  savedFilters,
  savedFilterId,
  onSavedFilterChange,
  titleStatus,
  onPatchFilters,
  onResetFilters,
  onOpenSettings,
}: OsFiltersPanelProps) {
  const filters = useOsFiltersStore((s) => s.filters);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const [productsOpen, setProductsOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedValue(productSearch, 250);

  const [requestersOpen, setRequestersOpen] = useState(false);
  const [requesterSearch, setRequesterSearch] = useState("");
  const debouncedRequesterSearch = useDebouncedValue(requesterSearch, 250);

  const [formatosOpen, setFormatosOpen] = useState(false);
  const [formatoSearch, setFormatoSearch] = useState("");
  const debouncedFormatoSearch = useDebouncedValue(formatoSearch, 250);
  const hasAdvanced = hasOsHomeAdvancedFilters(filters);
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvanced);

  useEffect(() => {
    if (hasAdvanced) {
      setAdvancedOpen(true);
    }
  }, [hasAdvanced]);

  const setoresQuery = useSetoresLookup();
  const situacoesQuery = useSituacoesLookup();
  const categoriasQuery = useCategoriasLookup();
  const maquinasQuery = useMaquinasLookup();
  const yearsQuery = useOsFilterYears();
  const productsQuery = useOsFilterProducts(debouncedProductSearch, productsOpen);
  const formatosQuery = useOsFilterFormatos(debouncedFormatoSearch, formatosOpen);
  const requestersQuery = useOsFilterRequesters(
    debouncedRequesterSearch,
    requestersOpen,
    filters.categorias,
  );

  const parseOptionalInt = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? undefined : n;
  };

  const yearOptions = useMemo(() => {
    const years = yearsQuery.data?.data ?? [];
    return years.map((y) => ({ value: String(y), label: String(y) }));
  }, [yearsQuery.data?.data]);

  const anosAsStrings = (filters.anos ?? []).map(String);

  return (
    <section className="shrink-0 rounded-lg border border-sagra-border border-t-4 border-t-secondary-blue bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-2 md:hidden">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-secondary-blue">
          {titleStatus}
        </h2>
        <button
          type="button"
          onClick={() => setMobileExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-sagra-border px-2 py-1 text-xs font-medium text-neutral-600"
          aria-expanded={mobileExpanded}
          data-testid={homeTestIds.osFiltersExpand}
        >
          {mobileExpanded ? (
            <>
              Ocultar <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              Expandir <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      </div>

      <div className={cn(!mobileExpanded && "hidden", "md:block")}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sagra-border px-3 py-2">
          <h2 className="hidden min-w-0 flex-1 text-sm font-semibold text-secondary-blue md:block">
            {titleStatus}
          </h2>

          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={filters.includeOs}
                onChange={(e) =>
                  onPatchFilters({ includeOs: e.target.checked, page: 1 })
                }
                className="accent-primary-green"
                data-testid={homeTestIds.osFiltersOs}
              />
              Exibir OSs
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={filters.includeSp}
                onChange={(e) =>
                  onPatchFilters({ includeSp: e.target.checked, page: 1 })
                }
                className="accent-primary-green"
                data-testid={homeTestIds.osFiltersSp}
              />
              Exibir SPs
            </label>
          </div>
        </div>

        <div className="os-filter-groups flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="os-filter-rail flex w-full shrink-0 flex-col gap-2 border-b border-sagra-border pb-3 lg:w-[11rem] lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
            {onOpenSettings ? (
              <button
                type="button"
                title="Preferências de filtros"
                onClick={onOpenSettings}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-sagra-border text-neutral-600 hover:bg-slate-50"
                aria-label="Abrir preferências de filtros"
                data-testid={homeTestIds.osFiltersCreate}
              >
                <Filter className="size-3.5" />
                <span className="text-xs font-medium">Criar filtros</span>
              </button>
            ) : null}
            <select
              value={savedFilterId}
              onChange={(e) => onSavedFilterChange(e.target.value)}
              className="h-8 w-full rounded border border-sagra-border bg-white px-2 text-sm"
              aria-label="Filtros salvos"
              data-testid={homeTestIds.osFiltersSaved}
            >
              <option value="">Meus Filtros...</option>
              {savedFilters.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.nome}
                  {f.is_default ? " (Padrão)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="os-filter-group-grid flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap xl:flex-nowrap xl:items-stretch xl:gap-0">
            <FilterGroup
              title="Ordem de serviço"
              className="w-auto shrink-0 xl:border-r xl:border-sagra-border xl:pr-4"
            >
              <FilterField label="Nr OS/Ano" labelWidth="os">
                <div className="flex w-[11.25rem] items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 2244"
                    value={filters.nrOs != null ? String(filters.nrOs) : ""}
                    onChange={(e) =>
                      onPatchFilters({
                        nrOs: parseOptionalInt(e.target.value),
                        page: 1,
                      })
                    }
                    className={cn(inputClass, "min-w-0 flex-[2]")}
                    aria-label="Nr OS"
                    data-testid={homeTestIds.osFiltersNrOs}
                  />
                  <span
                    className="shrink-0 text-sm font-semibold text-neutral-400"
                    aria-hidden
                  >
                    /
                  </span>
                  <MultiSelect
                    label="Ano"
                    hideLabel
                    aria-label="Ano"
                    testId={homeTestIds.osFiltersAno}
                    className="min-w-0 flex-[3] flex-none"
                    dropdownClassName="min-w-[8rem]"
                    options={yearOptions}
                    value={anosAsStrings}
                    onChange={(vals) =>
                      onPatchFilters({
                        anos: vals
                          .map((v) => Number.parseInt(v, 10))
                          .filter((n) => !Number.isNaN(n)),
                        page: 1,
                      })
                    }
                    disabled={yearsQuery.isLoading && yearOptions.length === 0}
                    placeholder={
                      yearsQuery.isLoading ? "Carregando..." : "Todos"
                    }
                  />
                </div>
              </FilterField>
              <FilterField label="Processo" labelWidth="os">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00.000.000/0000"
                  value={filters.processo ?? ""}
                  onChange={(e) =>
                    onPatchFilters({
                      processo: formatProcessoMask(e.target.value),
                      page: 1,
                    })
                  }
                  className={cn(inputClass, "w-[11.25rem] shrink-0")}
                  aria-label="Processo"
                  data-testid={homeTestIds.osFiltersProcesso}
                />
              </FilterField>
            </FilterGroup>

            <FilterGroup
              title="Solicitante"
              className="min-w-0 flex-1 xl:border-r xl:border-sagra-border xl:px-4"
            >
              <MultiSelect
                label="Categoria"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                testId={homeTestIds.osFiltersCategoria}
                options={categoriasQuery.data ?? []}
                value={filters.categorias}
                onChange={(categorias) =>
                  onPatchFilters({
                    categorias,
                    solicitantes: [],
                    solicitante: "",
                    page: 1,
                  })
                }
                disabled={categoriasQuery.isLoading}
              />
              <SearchableMultiSelect
                label="Nome"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                testId={homeTestIds.osFiltersNome}
                value={filters.solicitantes}
                onChange={(solicitantes) =>
                  onPatchFilters({ solicitantes, solicitante: "", page: 1 })
                }
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
              <FilterField label="Título">
                <input
                  type="text"
                  value={filters.titulo ?? ""}
                  onChange={(e) =>
                    onPatchFilters({ titulo: e.target.value, page: 1 })
                  }
                  className={cn(inputClass, "min-w-0 flex-1")}
                  data-testid={homeTestIds.osFiltersTitulo}
                />
              </FilterField>
              <MultiSelect
                label="Máquina"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                testId={homeTestIds.osFiltersMaquina}
                options={maquinasQuery.data ?? []}
                value={filters.maquinas}
                onChange={(maquinas) => onPatchFilters({ maquinas, page: 1 })}
                disabled={maquinasQuery.isLoading}
              />
              <SearchableMultiSelect
                label="Produto"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                testId={homeTestIds.osFiltersProduto}
                value={filters.produtos}
                onChange={(produtos) =>
                  onPatchFilters({ produtos, produto: "", page: 1 })
                }
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
                testId={homeTestIds.osFiltersPrioridade}
                options={PRIORIDADE_OPTIONS}
                value={filters.prioridade}
                onChange={(prioridade) =>
                  onPatchFilters({ prioridade, page: 1 })
                }
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
                testId={homeTestIds.osFiltersSetor}
                options={setoresQuery.data ?? []}
                value={filters.setor}
                onChange={(setor) => onPatchFilters({ setor, page: 1 })}
                disabled={setoresQuery.isLoading}
              />
              <MultiSelect
                label="Situação"
                labelSide="left"
                className="min-w-0 w-full flex-none"
                testId={homeTestIds.osFiltersSituacao}
                options={situacoesQuery.data ?? []}
                value={filters.situacao}
                onChange={(situacao) => onPatchFilters({ situacao, page: 1 })}
                disabled={situacoesQuery.isLoading}
              />
            </FilterGroup>
          </div>

          <div className="os-filter-actions flex w-full shrink-0 items-center justify-end gap-1.5 border-t border-sagra-border pt-3 lg:w-auto lg:flex-col lg:justify-center lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0">
            <button
              type="button"
              title="Limpar filtros"
              onClick={() => {
                setAdvancedOpen(false);
                onResetFilters();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              data-testid={homeTestIds.osFiltersClear}
            >
              <Eraser className="size-3.5" />
            </button>
            <button
              type="button"
              title="Atualizar"
              aria-label="Atualizar"
              onClick={onRefresh}
              disabled={isFetching}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary-green text-white hover:opacity-90 disabled:opacity-60"
              data-testid={homeTestIds.osFiltersRefresh}
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
            </button>
          </div>
        </div>

        {advancedOpen ? (
          <div className="grid grid-cols-1 gap-3 border-t border-sagra-border bg-slate-50/50 px-3 py-3 sm:grid-cols-3">
            <FilterField label="Data de entrada">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  type="date"
                  value={filters.dataEntradaDe ?? ""}
                  onChange={(e) =>
                    onPatchFilters({
                      dataEntradaDe: e.target.value,
                      page: 1,
                    })
                  }
                  className={cn(inputClass, "min-w-0 flex-1")}
                  aria-label="Data de entrada de"
                  data-testid={homeTestIds.osFiltersDataEntradaDe}
                />
                <span className="shrink-0 text-xs text-neutral-500">até</span>
                <input
                  type="date"
                  value={filters.dataEntradaAte ?? ""}
                  onChange={(e) =>
                    onPatchFilters({
                      dataEntradaAte: e.target.value,
                      page: 1,
                    })
                  }
                  className={cn(inputClass, "min-w-0 flex-1")}
                  aria-label="Data de entrada até"
                  data-testid={homeTestIds.osFiltersDataEntradaAte}
                />
              </div>
            </FilterField>
            <SearchableMultiSelect
              label="Formato"
              labelSide="left"
              className="min-w-0 w-full flex-none"
              testId={homeTestIds.osFiltersFormato}
              value={filters.formatos ?? []}
              onChange={(formatos) => onPatchFilters({ formatos, page: 1 })}
              options={formatosQuery.data?.data ?? []}
              isLoading={formatosQuery.isFetching}
              searchQuery={formatoSearch}
              onSearchChange={setFormatoSearch}
              onOpen={() => setFormatosOpen(true)}
            />
            <FilterField label="Papel">
              <input
                type="text"
                value={filters.papel ?? ""}
                onChange={(e) =>
                  onPatchFilters({ papel: e.target.value, page: 1 })
                }
                className={cn(inputClass, "min-w-0 flex-1")}
                data-testid={homeTestIds.osFiltersPapel}
              />
            </FilterField>
            <FilterField label="Cores">
              <input
                type="text"
                value={filters.cores ?? ""}
                onChange={(e) =>
                  onPatchFilters({ cores: e.target.value, page: 1 })
                }
                className={cn(inputClass, "min-w-0 flex-1")}
                data-testid={homeTestIds.osFiltersCores}
              />
            </FilterField>
            <FilterField label="Acabamento">
              <input
                type="text"
                value={filters.acabamento ?? ""}
                onChange={(e) =>
                  onPatchFilters({ acabamento: e.target.value, page: 1 })
                }
                className={cn(inputClass, "min-w-0 flex-1")}
                data-testid={homeTestIds.osFiltersAcabamento}
              />
            </FilterField>
            <FilterField label="Observação">
              <input
                type="text"
                value={filters.observacao ?? ""}
                onChange={(e) =>
                  onPatchFilters({ observacao: e.target.value, page: 1 })
                }
                className={cn(inputClass, "min-w-0 flex-1")}
                data-testid={homeTestIds.osFiltersObservacao}
              />
            </FilterField>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex h-6 w-full items-center justify-center border-t border-sagra-border bg-slate-50/80 text-neutral-500 hover:bg-slate-100"
          aria-expanded={advancedOpen}
          aria-label={
            advancedOpen
              ? "Recolher filtros avançados"
              : "Expandir filtros avançados"
          }
          data-testid={homeTestIds.osFiltersAdvancedToggle}
        >
          {advancedOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      </div>
    </section>
  );
}

const inputClass =
  "h-9 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30";

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
    <div className={cn("os-filter-group flex min-w-0 flex-col gap-2", className)}>
      <h3 className="text-[0.7rem] font-bold uppercase tracking-wide text-secondary-blue/80">
        {title}
      </h3>
      <div className={cn("flex min-w-0 flex-col gap-2", fieldsClassName)}>
        {children}
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
  className,
  labelWidth,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Alinha rótulos do grupo Ordem de serviço (Nr OS/Ano + Processo). */
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
