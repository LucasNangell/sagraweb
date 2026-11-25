import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  buscarManutencaoHistorico,
  fetchManutencaoMaquinas,
  fetchManutencaoPedido,
  fetchManutencaoPedidos,
  fetchManutencaoRecorrentes,
  fetchManutencaoResumo,
  fetchManutencaoSimilares,
  manutencaoKeys,
} from "@/api/manutencao";
import { toast } from "@/components/ui/toastStore";

const REFRESH_MS = 30_000;

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Ordem alfabética (pt-BR, ignora acentos/caixa; "PM 52" antes de "PM 100"). */
export function ordenarMaquinas<T extends { nome: string; codigo: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => collator.compare(a.nome, b.nome) || collator.compare(a.codigo, b.codigo),
  );
}

export function useResumo() {
  return useQuery({
    queryKey: manutencaoKeys.resumo,
    queryFn: fetchManutencaoResumo,
    refetchInterval: REFRESH_MS,
  });
}

export function useMaquinas(includeInactive = false) {
  return useQuery({
    queryKey: manutencaoKeys.maquinas(includeInactive),
    queryFn: () =>
      fetchManutencaoMaquinas(includeInactive).then((r) => ordenarMaquinas(r.items)),
    staleTime: 15_000,
  });
}

export function useRecorrentes(includeInactive = false) {
  return useQuery({
    queryKey: manutencaoKeys.recorrentes(includeInactive),
    queryFn: () => fetchManutencaoRecorrentes(includeInactive).then((r) => r.items),
    staleTime: 15_000,
  });
}

/** Abertos (fila/execução/pausados) + finalizados dos últimos `dias`. */
export function usePedidos(dias = 30, incluirSimilares = false) {
  return useQuery({
    queryKey: manutencaoKeys.pedidos(`all:${dias}:${incluirSimilares ? "sim" : "nao"}`),
    queryFn: () =>
      fetchManutencaoPedidos({ finalizadosDias: dias, incluirSimilares }).then((r) => r.items),
    refetchInterval: REFRESH_MS,
  });
}

export function useSimilares(id: number | null) {
  return useQuery({
    queryKey: manutencaoKeys.similares(id ?? 0),
    queryFn: () => fetchManutencaoSimilares(id as number).then((r) => r.items),
    enabled: id != null,
    staleTime: 60_000,
  });
}

export function useBuscaHistorico(q: string, maquinaId: number | null, enabled = true) {
  return useQuery({
    queryKey: manutencaoKeys.historico(q, maquinaId),
    queryFn: () => buscarManutencaoHistorico({ q, maquinaId }).then((r) => r.items),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useHistoricoMaquina(maquinaId: number | null) {
  return useQuery({
    queryKey: manutencaoKeys.pedidos(`maquina:${maquinaId}`),
    queryFn: () =>
      fetchManutencaoPedidos({ maquinaId: maquinaId ?? undefined, finalizadosDias: 3650 }).then(
        (r) => r.items,
      ),
    enabled: maquinaId != null,
  });
}

export function usePedido(id: number | null) {
  return useQuery({
    queryKey: manutencaoKeys.pedido(id ?? 0),
    queryFn: () => fetchManutencaoPedido(id as number),
    enabled: id != null,
  });
}

export function errorMessage(err: unknown, fallback = "Não foi possível concluir a ação."): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/** Mutation com invalidação do módulo inteiro + toast de sucesso/erro. */
export function useManutencaoMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: manutencaoKeys.all });
      const msg = typeof opts.success === "function" ? opts.success(result) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(result);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: manutencaoKeys.all });
    },
  });
}
