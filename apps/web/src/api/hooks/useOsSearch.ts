import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { searchOs } from "@/api/os";
import { osSearchQueryKey } from "@/features/os/osSearchQueryKey";
import {
  dedupeOsSearchResponse,
  normalizeOsSearchFilters,
} from "@/features/os/osSearchUtils";
import type { OsSearchFilters } from "@/features/os/types";

/** WS invalida/refetch; staleTime evita re-GET ao remountar a home. */
export const OS_SEARCH_STALE_MS = 30_000;
export const OS_SEARCH_GC_MS = 5 * 60_000;
/** Mantido para testes/compat; o poll contínuo da home foi desligado. */
export const OS_SEARCH_SAFETY_POLL_MS = 120_000;

export function useOsSearch(filters: OsSearchFilters, enabled = true) {
  const normalized = normalizeOsSearchFilters(filters);
  return useQuery({
    queryKey: osSearchQueryKey(filters),
    queryFn: async ({ signal }) =>
      dedupeOsSearchResponse(await searchOs(normalized, { signal })),
    enabled,
    staleTime: OS_SEARCH_STALE_MS,
    gcTime: OS_SEARCH_GC_MS,
    placeholderData: keepPreviousData,
    structuralSharing: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}
