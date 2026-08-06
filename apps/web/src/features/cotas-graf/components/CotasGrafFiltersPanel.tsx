import { cn } from "@sagra/ui";
import { ChevronDown, ChevronUp, Eraser, Filter, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  useOsFilterProducts,
  useOsFilterRequesters,
  useOsFilterYears,
} from "@/api/hooks/useOsFilterOptions";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { SavedFilter } from "@/features/os/types";
import type { YearFilterMode } from "@/features/os/types";

import { useCotasGrafFiltersStore } from "../cotasGrafFiltersStore";
import { SITUACAO_COTAS_OPTIONS } from "../types";
import type { CotasGrafSearchFilters } from "../types";

interface CotasGrafFiltersPanelProps {
  onRefresh: () => void;
  isFetching?: boolean;
  savedFilters: SavedFilter[];
  savedFilterId: string;
  onSavedFilterChange: (id: string) => void;
  filterStatus: ReactNode;
  onPatchFilters: (patch: Partial<CotasGrafSearchFilters>) => void;
  onResetFilters: () => void;
  onOpenSettings?: () => void;
}

const YEAR_MODE_OPTIONS: { value: YearFilterMode; label: string }[] = [
  { value: "from", label: "A partir de" },
  { value: "specific", label: "Ano específico" },
];

export function CotasGrafFiltersPanel({
  onRefresh,
  isFetching,
  savedFilters,
  savedFilterId,
  onSavedFilterChange,
  filterStatus,
  onPatchFilters,
  onResetFilters,
  onOpenSettings,
}: CotasGrafFiltersPanelProps) {
  const filters = useCotasGrafFiltersStore((s) => s.filters);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const [productsOpen, setProductsOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedValue(productSearch, 250);

  const [requestersOpen, setRequestersOpen] = useState(false);
  const [requesterSearch, setRequesterSearch] = useState("");
  const debouncedRequesterSearch = useDebouncedValue(requesterSearch, 250);

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

  const yearOptions = yearsQuery.data?.data ?? [];

  return (
    <section className="shrink-0 rounded-lg border border-sagra-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-2 md:hidden">
        <h2 className="text-sm font-semibold text-secondary-blue">Filtros de Pesquisa</h2>
        <button
          type="button"
          onClick={() => setMobileExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded border border-sagra-border px-2 py-1 text-xs font-medium text-neutral-600"
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
          <h2 className="hidden text-sm font-semibold text-secondary-blue md:block">
            Filtros de Pesquisa
          </h2>

          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={filters.includeFinished}
                onChange={(e) =>
                  onPatchFilters({ includeFinished: e.target.checked, page: 1 })
                }
                className="accent-primary-green"
              />
              Exibir entregues e canceladas
            </label>
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

        <div className="flex flex-col gap-2 border-b border-sagra-border/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {onOpenSettings ? (
            <button
              type="button"
              title="Preferências de filtros Cotas Graf"
              onClick={onOpenSettings}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-sagra-border text-neutral-600 hover:bg-slate-50"
              aria-label="Abrir preferências de filtros Cotas Graf"
            >
              <Filter className="size-3.5" />
            </button>
          ) : null}
          <select
            value={savedFilterId}
            onChange={(e) => onSavedFilterChange(e.target.value)}
            className="h-8 w-full min-w-0 rounded border border-sagra-border bg-white px-2 text-sm sm:min-w-[140px] sm:max-w-[220px] sm:w-auto"
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
          <div className="min-w-0 flex-1 text-sm break-words">{filterStatus}</div>
        </div>

        <div className="os-filter-row flex flex-wrap items-end gap-2 px-3 py-2">
          <FilterField label="Nr OS" className="os-filter-field--xs">
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

          <div className={cn("min-w-0 os-filter-field--sm")}>
            <div className="mb-1 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <span className="text-xs font-semibold text-neutral-600">Ano</span>
              <SegmentedControl
                options={YEAR_MODE_OPTIONS}
                value={filters.anoMode}
                onChange={(anoMode) => onPatchFilters({ anoMode, page: 1 })}
                ariaLabel="Modo do filtro de ano"
              />
            </div>
            <select
              value={filters.ano != null ? String(filters.ano) : ""}
              onChange={(e) =>
                onPatchFilters({
                  ano: parseOptionalInt(e.target.value),
                  page: 1,
                })
              }
              disabled={yearsQuery.isLoading && yearOptions.length === 0}
              className={cn(inputClass, yearsQuery.isLoading && "text-neutral-400")}
              aria-label="Ano"
            >
              <option value="">
                {yearsQuery.isLoading ? "Carregando..." : "Todos"}
              </option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <SearchableMultiSelect
            label="Produto"
            className="os-filter-field--sm"
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

          <FilterField label="Título" className="os-filter-field--sm">
            <input
              type="text"
              value={filters.titulo ?? ""}
              onChange={(e) => onPatchFilters({ titulo: e.target.value, page: 1 })}
              className={inputClass}
            />
          </FilterField>

          <SearchableMultiSelect
            label="Solicitante"
            className="os-filter-field--sm"
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

          <MultiSelect
            label="Situação Cotas"
            options={[...SITUACAO_COTAS_OPTIONS]}
            value={filters.situacaoCotas}
            onChange={(situacaoCotas) => onPatchFilters({ situacaoCotas, page: 1 })}
            className="os-filter-field--md"
          />

          <div className="os-filter-actions flex w-full shrink-0 items-end justify-end gap-1.5 sm:w-auto">
            <button
              type="button"
              title="Limpar filtros"
              onClick={onResetFilters}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-sagra-border text-neutral-600 hover:bg-slate-50"
            >
              <Eraser className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isFetching}
              className="flex h-8 min-w-[7.5rem] items-center justify-center gap-1.5 rounded bg-primary-green px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
              Atualizar
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

const inputClass =
  "h-9 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30";

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
