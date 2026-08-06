import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getDefaultAnos } from "./osFilterDefaults";
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
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
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

      resetFilters: () =>
        set({
          filters: {
            ...defaultOsFilters(),
            // Limpar filtros: Ano = "Todos" (abertura da home mantém ano default).
            anos: [],
          },
          globalSearch: "",
        }),

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
        },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<OsFiltersState> | undefined;
        if (!p?.filters) {
          return current;
        }
        return {
          ...current,
          filters: {
            ...current.filters,
            includeFinished: true,
            includeOs: p.filters.includeOs ?? current.filters.includeOs,
            includeSp: p.filters.includeSp ?? current.filters.includeSp,
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
