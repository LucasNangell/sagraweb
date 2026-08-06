import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  getDefaultFromYearValue,
  getDefaultYearMode,
} from "@/features/os/osFilterDefaults";
import type { CotasGrafSearchFilters } from "./types";
import { DEFAULT_COTAS_GRAF_PAGE_SIZE } from "./types";

const TOGGLES_KEY = "sagra-cotas-graf-filter-toggles";

export const defaultCotasGrafFilters = (): CotasGrafSearchFilters => ({
  nrOs: undefined,
  ano: getDefaultFromYearValue(),
  anoMode: getDefaultYearMode(),
  produto: "",
  produtos: [],
  titulo: "",
  solicitante: "",
  solicitantes: [],
  situacaoCotas: [],
  includeFinished: false,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: DEFAULT_COTAS_GRAF_PAGE_SIZE,
});

interface CotasGrafFiltersState {
  filters: CotasGrafSearchFilters;
  filtersExpanded: boolean;
  setFiltersExpanded: (value: boolean) => void;
  patchFilters: (patch: Partial<CotasGrafSearchFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
}

export const useCotasGrafFiltersStore = create<CotasGrafFiltersState>()(
  persist(
    (set, get) => ({
      filters: defaultCotasGrafFilters(),
      filtersExpanded: true,

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
          filters: defaultCotasGrafFilters(),
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
          includeFinished: state.filters.includeFinished,
          includeOs: state.filters.includeOs,
          includeSp: state.filters.includeSp,
        },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<CotasGrafFiltersState> | undefined;
        if (!p?.filters) {
          return current;
        }
        return {
          ...current,
          filters: {
            ...current.filters,
            includeFinished:
              p.filters.includeFinished ?? current.filters.includeFinished,
            includeOs: p.filters.includeOs ?? current.filters.includeOs,
            includeSp: p.filters.includeSp ?? current.filters.includeSp,
          },
        };
      },
    },
  ),
);
