import { queryKeys } from "@/api/query-keys";

import { normalizeOsSearchFilters } from "./osSearchUtils";
import type { OsSearchFilters } from "./types";

/** Chave estável (string) — evita mismatch de objetos no cache do React Query. */
export function serializeOsSearchFilters(filters: OsSearchFilters): string {
  return JSON.stringify(normalizeOsSearchFilters(filters));
}

export function osSearchQueryKey(filters: OsSearchFilters) {
  return [...queryKeys.os.searchPrefix, serializeOsSearchFilters(filters)] as const;
}
