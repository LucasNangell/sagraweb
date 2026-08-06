import { useQuery } from "@tanstack/react-query";

import {
  fetchSavedFilters,
  fetchUserFiltersDefault,
  type SavedFilterContext,
} from "@/api/settings";
import { queryKeys } from "@/api/query-keys";

export function useSavedFilters(
  ponto: string | null,
  context: SavedFilterContext = "os",
) {
  return useQuery({
    queryKey: ponto
      ? queryKeys.settings.savedFilters(ponto, context)
      : ["settings", "savedFilters", "idle", context],
    queryFn: () => fetchSavedFilters(ponto!, context),
    enabled: Boolean(ponto),
    staleTime: 120_000,
  });
}

export function useUserFiltersDefault(
  ponto: string | null,
  context: SavedFilterContext = "os",
) {
  return useQuery({
    queryKey: ponto
      ? queryKeys.settings.defaultFilters(ponto, context)
      : ["settings", "defaultFilters", "idle", context],
    queryFn: () => fetchUserFiltersDefault(ponto!, context),
    enabled: Boolean(ponto),
    staleTime: 120_000,
  });
}
