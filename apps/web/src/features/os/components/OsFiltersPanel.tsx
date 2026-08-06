import { cn } from "@sagra/ui";
import { ChevronDown, ChevronUp, Eraser, Filter, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import {
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

  const setoresQuery = useSetoresLookup();
  const situacoesQuery = useSituacoesLookup();
  const categoriasQuery = useCategoriasLookup();
  const maquinasQuery = useMaquinasLookup();
  const yearsQuery = useOsFilterYears();
  const productsQuery = useOsFilterProducts(debouncedProductSearch, productsOpen);
  const requestersQuery = useOsFilterRequesters(
    debouncedRequesterSearch,
    requestersOpen,
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
    <section className="shrink-0 rounded-lg border border-sagra-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-2 md:hidden">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-secondary-blue">
          {titleStatus}
        </h2>
        <button
          type="button"
          onClick={() => setMobileExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-sagra-border px-2 py-1 text-xs font-medium text-neutral-600"
          aria-expanded={mobileExpanded}
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
              <div className="os-filter-os-pair grid grid-cols-[5rem_auto_5rem] gap-x-1.5 gap-y-2">
                <FilterField label="Nr OS">
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
                    className={inputClass}
                  />
                </FilterField>
                <span
                  className="mb-2 self-end text-sm font-semibold text-neutral-400"
                  aria-hidden
                >
                  /
                </span>
                <MultiSelect
                  label="Ano"
                  className="min-w-0 w-full flex-none"
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
                <FilterField label="Processo" className="col-span-3 min-w-0">
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
                    className={cn(inputClass, "min-w-0 w-full")}
                    aria-label="Processo"
                  />
                </FilterField>
              </div>
            </FilterGroup>

            <FilterGroup
              title="Solicitante"
              className="w-full shrink-0 sm:w-[12rem] xl:border-r xl:border-sagra-border xl:px-4"
            >
              <MultiSelect
                label="Categoria"
                className="min-w-0 w-full flex-none"
                options={categoriasQuery.data ?? []}
                value={filters.categorias}
                onChange={(categorias) =>
                  onPatchFilters({ categorias, page: 1 })
                }
                disabled={categoriasQuery.isLoading}
              />
              <SearchableMultiSelect
                label="Nome"
                className="min-w-0 w-full flex-none"
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
              className="min-w-0 flex-1 xl:border-r xl:border-sagra-border xl:px-4"
              fieldsClassName="grid w-full grid-cols-2 gap-2"
            >
              <FilterField label="Título" className="min-w-0">
                <input
                  type="text"
                  value={filters.titulo ?? ""}
                  onChange={(e) =>
                    onPatchFilters({ titulo: e.target.value, page: 1 })
                  }
                  className={inputClass}
                />
              </FilterField>
              <SearchableMultiSelect
                label="Produto"
                className="min-w-0 w-full flex-none"
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
                label="Máquina"
                className="min-w-0 w-full flex-none"
                options={maquinasQuery.data ?? []}
                value={filters.maquinas}
                onChange={(maquinas) => onPatchFilters({ maquinas, page: 1 })}
                disabled={maquinasQuery.isLoading}
              />
              <MultiSelect
                label="Prioridade"
                className="min-w-0 w-full flex-none"
                options={PRIORIDADE_OPTIONS}
                value={filters.prioridade}
                onChange={(prioridade) =>
                  onPatchFilters({ prioridade, page: 1 })
                }
              />
            </FilterGroup>

            <FilterGroup
              title="Andamento"
              className="w-full shrink-0 sm:w-[12rem] xl:pl-4"
            >
              <MultiSelect
                label="Setor"
                className="min-w-0 w-full flex-none"
                options={setoresQuery.data ?? []}
                value={filters.setor}
                onChange={(setor) => onPatchFilters({ setor, page: 1 })}
                disabled={setoresQuery.isLoading}
              />
              <MultiSelect
                label="Situação"
                className="min-w-0 w-full flex-none"
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
              onClick={onResetFilters}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
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
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
            </button>
          </div>
        </div>
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
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-1 block text-xs font-semibold text-neutral-600">
        {label}
      </label>
      {children}
    </div>
  );
}
