import type { UseQueryResult } from "@tanstack/react-query";

/** Resultado combinado de `useQueries`; `data[i]` corresponde ao i-ésimo id solicitado. */
export function combineDetailResults<T>(results: UseQueryResult<T>[]) {
  return {
    data: results.map((r) => r.data),
    failed: results.map((r) => r.isError),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}
