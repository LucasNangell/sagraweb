import { useQuery } from "@tanstack/react-query";

import {
  fetchOsFilterFormatos,
  fetchOsFilterProducts,
  fetchOsFilterRequesters,
  fetchOsFilterYears,
} from "@/api/osFilterOptions";

const OPTIONS_STALE_MS = 10 * 60_000;
const OPTIONS_GC_MS = 30 * 60_000;

export function useOsFilterYears(enabled = true) {
  return useQuery({
    queryKey: ["os-filter-years"],
    queryFn: ({ signal }) => fetchOsFilterYears({ signal }),
    enabled,
    staleTime: OPTIONS_STALE_MS,
    gcTime: OPTIONS_GC_MS,
  });
}

export function useOsFilterProducts(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: ["os-filter-products", term],
    queryFn: ({ signal }) => fetchOsFilterProducts(term, 30, { signal }),
    enabled,
    staleTime: OPTIONS_STALE_MS,
    gcTime: OPTIONS_GC_MS,
  });
}

export function useOsFilterRequesters(
  q: string,
  enabled: boolean,
  categorias: string[] = [],
) {
  const term = q.trim();
  const cats = (categorias ?? []).map((c) => c.trim()).filter(Boolean);
  return useQuery({
    queryKey: ["os-filter-requesters", term, cats],
    queryFn: ({ signal }) =>
      fetchOsFilterRequesters(term, 30, { signal }, cats),
    enabled,
    staleTime: OPTIONS_STALE_MS,
    gcTime: OPTIONS_GC_MS,
  });
}

export function useOsFilterFormatos(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: ["os-filter-formatos", term],
    queryFn: ({ signal }) => fetchOsFilterFormatos(term, 30, { signal }),
    enabled,
    staleTime: OPTIONS_STALE_MS,
    gcTime: OPTIONS_GC_MS,
  });
}
