import { fetchClienteDashboard } from "@/api/cliente-portal";

export const clienteDashboardQueryKey = ["cliente", "dashboard"] as const;

export const CLIENTE_DASHBOARD_STALE_MS = 60_000;
export const CLIENTE_DASHBOARD_REFETCH_INTERVAL_MS = 60_000;

/** Opções compartilhadas da query principal do painel `/cliente`. */
export function clienteDashboardQueryOptions() {
  return {
    queryKey: clienteDashboardQueryKey,
    queryFn: fetchClienteDashboard,
    staleTime: CLIENTE_DASHBOARD_STALE_MS,
    refetchInterval: CLIENTE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  };
}
