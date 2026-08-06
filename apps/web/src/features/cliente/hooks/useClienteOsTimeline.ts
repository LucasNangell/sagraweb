import { useQuery } from "@tanstack/react-query";

import { fetchClienteOsTimeline } from "@/api/cliente-portal";

export function useClienteOsTimeline(
  ano: number,
  nrOs: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cliente", "timeline", ano, nrOs],
    queryFn: () => fetchClienteOsTimeline(ano, nrOs),
    enabled: options?.enabled ?? false,
    staleTime: 30_000,
  });
}
