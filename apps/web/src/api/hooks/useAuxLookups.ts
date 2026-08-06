import { useQuery } from "@tanstack/react-query";

import {
  fetchCategorias,
  fetchMaquinas,
  fetchSetores,
  fetchSituacoes,
} from "@/api/aux";
import { queryKeys } from "@/api/query-keys";

const LOOKUP_STALE_MS = 5 * 60 * 1000;

export function useSetoresLookup() {
  return useQuery({
    queryKey: queryKeys.aux.setores,
    queryFn: fetchSetores,
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useSituacoesLookup() {
  return useQuery({
    queryKey: queryKeys.aux.situacoes,
    queryFn: fetchSituacoes,
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useCategoriasLookup() {
  return useQuery({
    queryKey: queryKeys.aux.categorias,
    queryFn: fetchCategorias,
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useMaquinasLookup() {
  return useQuery({
    queryKey: queryKeys.aux.maquinas,
    queryFn: fetchMaquinas,
    staleTime: LOOKUP_STALE_MS,
  });
}
