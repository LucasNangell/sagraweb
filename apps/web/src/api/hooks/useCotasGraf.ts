import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchCotasGrafList,
  fetchCotasGrafSolicitantesCotas,
  fetchSolicitanteConsumoHistorico,
  lancarCotasGraf,
} from "@/api/cotasGraf";
import type { CotasGrafSolicitanteClienteKey } from "@/api/cotasGraf";
import { queryKeys } from "@/api/query-keys";
import type { CotasGrafSearchFilters } from "@/features/cotas-graf/types";
import { hasCotasGrafTextFilterBelowMinLength } from "@/features/cotas-graf/filterStatus";

export function useCotasGrafList(
  filters: CotasGrafSearchFilters,
  enabled = true,
) {
  const blocked = hasCotasGrafTextFilterBelowMinLength(filters);
  return useQuery({
    queryKey: queryKeys.cotasGraf.list(filters),
    queryFn: () => fetchCotasGrafList(filters),
    enabled: enabled && !blocked,
    staleTime: 30_000,
  });
}

export function useCotasGrafSolicitantesCotas(
  filters: CotasGrafSearchFilters,
  enabled = true,
) {
  const blocked = hasCotasGrafTextFilterBelowMinLength(filters);
  return useQuery({
    queryKey: queryKeys.cotasGraf.solicitantesCotas(filters),
    queryFn: () => fetchCotasGrafSolicitantesCotas(filters),
    enabled: enabled && !blocked,
    staleTime: 30_000,
  });
}

export function useSolicitanteConsumoHistorico(
  cliente: CotasGrafSolicitanteClienteKey | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.cotasGraf.solicitanteHistorico(cliente),
    queryFn: () => fetchSolicitanteConsumoHistorico(cliente!),
    enabled: enabled && cliente != null,
    staleTime: 60_000,
  });
}

export function useLancarCotasGrafMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ano, nrOs }: { ano: number; nrOs: number }) =>
      lancarCotasGraf(ano, nrOs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cotasGraf.prefix });
    },
  });
}
