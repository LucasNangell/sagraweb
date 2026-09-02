import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getDefaultAnos } from "./osFilterDefaults";
import { DEFAULT_OS_SORTS, sanitizeOsSorts, sortsToFilterPatch } from "./osSortKeys";
import type { OsSearchFilters } from "./types";
import { DEFAULT_PAGE_SIZE } from "./types";

const TOGGLES_KEY = "sagra-os-filter-toggles";

/** Estado inicial: ano corrente (performance + escopo na abertura). */
export const defaultOsFilters = (): OsSearchFilters => ({
  nrOs: undefined,
  anos: getDefaultAnos(),
  produto: "",
  produtos: [],
  titulo: "",
  processo: "",
  solicitante: "",
  solicitantes: [],
  categorias: [],
  maquinas: [],
  situacao: [],
  setor: [],
  prioridade: [],
  formatos: [],
  papel: "",
  cores: "",
  acabamento: "",
  observacao: "",
  dataEntradaDe: "",
  dataEntradaAte: "",
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  sortBy: "ano",
  sortDir: "asc",
  sorts: [...DEFAULT_OS_SORTS],
  fetchAll: true,
});

interface OsFiltersState {
  filters: OsSearchFilters;
  globalSearch: string;
  filtersExpanded: boolean;
  setGlobalSearch: (value: string) => void;
  setFiltersExpanded: (value: boolean) => void;
  patchFilters: (patch: Partial<OsSearchFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
}

export const useOsFiltersStore = create<OsFiltersState>()(
  persist(
    (set, get) => ({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,

      setGlobalSearch: (value) => set({ globalSearch: value }),

      setFiltersExpanded: (value) => set({ filtersExpanded: value }),

      patchFilters: (patch) =>
        set({
          filters: {
            ...get().filters,
            ...patch,
            page: patch.page ?? 1,
          },
        }),

      resetFilters: () => {
        const current = get().filters;
        set({
          filters: {
            ...defaultOsFilters(),
            ...sortsToFilterPatch(current.sorts ?? DEFAULT_OS_SORTS),
          },
          globalSearch: "",
        });
      },

      setPage: (page) =>
        set({
          filters: { ...get().filters, page },
        }),
    }),
    {
      name: TOGGLES_KEY,
      partialize: (state) => ({
        filters: {
          includeOs: state.filters.includeOs,
          includeSp: state.filters.includeSp,
          sorts: state.filters.sorts,
          sortBy: state.filters.sortBy,
          sortDir: state.filters.sortDir,
        },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<OsFiltersState> | undefined;
        if (!p?.filters) {
          return current;
        }
        const restoredSorts = sanitizeOsSorts(p.filters.sorts);
        const sortPatch =
          restoredSorts !== undefined
            ? sortsToFilterPatch(restoredSorts)
            : p.filters.sortBy
              ? sortsToFilterPatch(
                  sanitizeOsSorts([
                    {
                      column: p.filters.sortBy,
                      dir: p.filters.sortDir === "desc" ? "desc" : "asc",
                    },
                  ]) ?? DEFAULT_OS_SORTS,
                )
              : {};
        return {
          ...current,
          filters: {
            ...current.filters,
            includeFinished: true,
            includeOs: p.filters.includeOs ?? current.filters.includeOs,
            includeSp: p.filters.includeSp ?? current.filters.includeSp,
            ...sortPatch,
          },
        };
      },
    },
  ),
);

/** Aplica busca global com debounce nos campos de texto da API. */
export function applyGlobalSearchToFilters(
  filters: OsSearchFilters,
  globalSearch: string,
): OsSearchFilters {
  const q = globalSearch.trim();
  if (!q) {
    return filters;
  }
  return {
    ...filters,
    titulo: q,
  };
}
