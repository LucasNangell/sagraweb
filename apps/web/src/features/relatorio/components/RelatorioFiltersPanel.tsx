import { cn } from "@sagra/ui";
import { ChevronDown, ChevronUp, Eraser } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { MultiSelect } from "@/components/ui/multi-select";
import { PRIORIDADE_OPTIONS } from "@/features/os/types";
import type { SavedFilter } from "@/features/os/types";
import { DEFAULT_SORT_BY } from "../constants";
import type { RelatorioFilters } from "../types";
import { getSortOptions } from "../utils";

interface RelatorioFiltersPanelProps {
  filters: RelatorioFilters;
  onPatchFilters: (patch: Partial<RelatorioFilters>) => void;
  onClearFilters: () => void;
  savedFilters: SavedFilter[];
  savedFilterId: string;
  onSavedFilterChange: (id: string) => void;
  savedFiltersLoading?: boolean;
  auxError?: string | null;
}

const inputClass =
  "h-9 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30";

const sortOptions = [
  { value: DEFAULT_SORT_BY, label: "Número OS" },
  ...getSortOptions().filter((o) => o.value !== DEFAULT_SORT_BY),
];

export function RelatorioFiltersPanel({
  filters,
  onPatchFilters,
  onClearFilters,
  savedFilters,
  savedFilterId,
  onSavedFilterChange,
  savedFiltersLoading,
  auxError,
}: RelatorioFiltersPanelProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const setoresQuery = useSetoresLookup();
  const situacoesQuery = useSituacoesLookup();

  const auxLoadError =
    auxError ??
    (setoresQuery.isError
      ? "Falha ao carregar setores."
      : situacoesQuery.isError
        ? "Falha ao carregar situações."
        : null);

  return (
    <section className="shrink-0 rounded-lg border border-sagra-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-2 md:hidden">
        <h2 className="text-sm font-semibold text-secondary-blue">
          Filtros do Relatório
        </h2>
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
      <div className="flex flex-col gap-3 border-b border-sagra-border px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="hidden text-sm font-semibold text-secondary-blue md:block">
          Filtros do Relatório
        </h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <select
            value={savedFilterId}
            onChange={(e) => onSavedFilterChange(e.target.value)}
            disabled={savedFiltersLoading}
            className="h-8 w-full min-w-0 rounded border border-sagra-border bg-white px-2 text-sm sm:min-w-[140px] sm:max-w-[220px] sm:w-auto"
            aria-label="Filtros salvos"
          >
            <option value="">
              {savedFiltersLoading ? "Carregando filtros..." : "Meus Filtros..."}
            </option>
            {savedFilters.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.nome}
                {f.is_default ? " (Padrão)" : ""}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={filters.includeFinished}
              onChange={(e) =>
                onPatchFilters({ includeFinished: e.target.checked })
              }
              className="accent-primary-green"
            />
            Incluir entregues e canceladas
          </label>
        </div>
      </div>

      {auxLoadError ? (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          {auxLoadError}
        </p>
      ) : null}

      <div className="os-filter-row flex flex-wrap items-end gap-2 px-3 py-2">
        <FilterField label="Nr OS" className="os-filter-field--xs">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Ex: 2244"
            value={filters.nrOs}
            onChange={(e) => onPatchFilters({ nrOs: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Ano" className="os-filter-field--xs">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Ex: 2025"
            value={filters.ano}
            onChange={(e) => onPatchFilters({ ano: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Produto" className="os-filter-field--sm">
          <input
            type="text"
            value={filters.produto}
            onChange={(e) => onPatchFilters({ produto: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Título" className="os-filter-field--sm">
          <input
            type="text"
            value={filters.titulo}
            onChange={(e) => onPatchFilters({ titulo: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={inputClass}
          />
        </FilterField>

        <FilterField label="Solicitante" className="os-filter-field--sm">
          <input
            type="text"
            value={filters.solicitante}
            onChange={(e) => onPatchFilters({ solicitante: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={inputClass}
          />
        </FilterField>

        <MultiSelect
          label="Situação"
          options={situacoesQuery.data ?? []}
          value={filters.situacao}
          onChange={(situacao) => onPatchFilters({ situacao })}
          disabled={situacoesQuery.isLoading}
          className="os-filter-field--md"
        />

        <MultiSelect
          label="Setor"
          options={setoresQuery.data ?? []}
          value={filters.setor}
          onChange={(setor) => onPatchFilters({ setor })}
          disabled={setoresQuery.isLoading}
          className="os-filter-field--md"
        />

        <MultiSelect
          label="Prioridade"
          options={PRIORIDADE_OPTIONS}
          value={filters.prioridade}
          onChange={(prioridade) => onPatchFilters({ prioridade })}
          className="os-filter-field--md"
        />

        <FilterField label="Ordenar Por" className="os-filter-field--md">
          <select
            value={filters.sortBy}
            onChange={(e) => onPatchFilters({ sortBy: e.target.value })}
            className={inputClass}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Ordem" className="os-filter-field--sm">
          <select
            value={filters.sortOrder}
            onChange={(e) =>
              onPatchFilters({
                sortOrder: e.target.value as RelatorioFilters["sortOrder"],
              })
            }
            className={inputClass}
          >
            <option value="DESC">Decrescente</option>
            <option value="ASC">Crescente</option>
          </select>
        </FilterField>

        <div className="os-filter-actions flex w-full shrink-0 items-end justify-end sm:w-auto">
          <button
            type="button"
            title="Limpar filtros"
            onClick={onClearFilters}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-sagra-border text-neutral-600 hover:bg-slate-50"
          >
            <Eraser className="size-3.5" />
          </button>
        </div>
      </div>
      </div>
    </section>
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
