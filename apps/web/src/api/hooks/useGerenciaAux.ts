import { useQuery } from "@tanstack/react-query";

import {
  fetchCategorias,
  fetchCores,
  fetchFormatos,
  fetchMaquinas,
  fetchPapeis,
  fetchProdutos,
} from "@/api/aux";
import { queryKeys } from "@/api/query-keys";

const STALE_MS = 5 * 60 * 1000;

export function useGerenciaAuxLookups() {
  const categorias = useQuery({
    queryKey: queryKeys.gerencia.categorias,
    queryFn: fetchCategorias,
    staleTime: STALE_MS,
  });
  const produtos = useQuery({
    queryKey: queryKeys.gerencia.produtos,
    queryFn: fetchProdutos,
    staleTime: STALE_MS,
  });
  const maquinas = useQuery({
    queryKey: queryKeys.gerencia.maquinas,
    queryFn: fetchMaquinas,
    staleTime: STALE_MS,
  });
  const papeis = useQuery({
    queryKey: queryKeys.gerencia.papeis,
    queryFn: fetchPapeis,
    staleTime: STALE_MS,
  });
  const cores = useQuery({
    queryKey: queryKeys.gerencia.cores,
    queryFn: fetchCores,
    staleTime: STALE_MS,
  });
  const formatos = useQuery({
    queryKey: queryKeys.gerencia.formatos,
    queryFn: fetchFormatos,
    staleTime: STALE_MS,
  });

  const loading =
    categorias.isLoading ||
    produtos.isLoading ||
    maquinas.isLoading ||
    papeis.isLoading ||
    cores.isLoading ||
    formatos.isLoading;

  return {
    loading,
    categorias: categorias.data ?? [],
    produtos: produtos.data ?? [],
    maquinas: maquinas.data ?? [],
    papeis: papeis.data ?? [],
    cores: cores.data ?? [],
    formatos: formatos.data ?? [],
  };
}
