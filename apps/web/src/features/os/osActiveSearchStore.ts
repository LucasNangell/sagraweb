import { create } from "zustand";

import type { OsSearchFilters } from "./types";

interface OsActiveSearchState {
  filters: OsSearchFilters | null;
  refetch: (() => Promise<unknown>) | null;
  register: (
    filters: OsSearchFilters,
    refetch: () => Promise<unknown>,
  ) => void;
  clear: () => void;
}

/** Query ativa da OsHomePage — refetch() garante atualização da lista na UI. */
export const useOsActiveSearchStore = create<OsActiveSearchState>((set) => ({
  filters: null,
  refetch: null,
  register: (filters, refetch) => set({ filters, refetch }),
  clear: () => set({ filters: null, refetch: null }),
}));

export function getActiveOsSearchFilters(): OsSearchFilters | null {
  return useOsActiveSearchStore.getState().filters;
}

export async function refetchActiveOsSearchList(): Promise<boolean> {
  const refetch = useOsActiveSearchStore.getState().refetch;
  if (!refetch) {
    return false;
  }
  await refetch();
  return true;
}
