import { QueryClient } from "@tanstack/react-query";

import { isNetworkError, isSessionError } from "@/lib/sessionEvents";

/**
 * Sessão expirada: não insiste (a reconexão automática invalida as queries ao
 * restaurar). Falha de rede: algumas tentativas extras com backoff.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isSessionError(error)) return false;
  if (isNetworkError(error)) return failureCount < 3;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
});
