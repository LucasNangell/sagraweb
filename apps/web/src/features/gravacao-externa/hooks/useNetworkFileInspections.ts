import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { inspectNetworkFiles, type NetworkFileInspection, type NetworkFilePick } from "@/api/networkFiles";

export function networkInspectionKey(path: string, maquina = ""): string {
  return JSON.stringify([path, maquina.trim().toUpperCase()]);
}

const queryKey = (file: NetworkFilePick) => ["networkFiles", "inspect", networkInspectionKey(file.absolute_path, file.maquina)] as const;

// O limite pertence à sessão do modal, inclusive durante mudanças na seleção.
function createInspectionQueue() {
  let active = 0;
  let failure: unknown;
  const waiting: (() => void)[] = [];
  function drain() {
    while (active < 2 && waiting.length) waiting.shift()!();
  }
  return {
    reset: () => { failure = undefined; },
    run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const abort = () => {
          const index = waiting.indexOf(start);
          if (index >= 0) waiting.splice(index, 1);
          reject(new DOMException("Verificação cancelada", "AbortError"));
        };
        const start = () => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) { abort(); return; }
          if (failure) { reject(failure); return; }
          active++;
          void task().then(resolve, error => {
            if (!signal.aborted) failure = error;
            reject(error);
          }).finally(() => { active--; drain(); });
        };
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        waiting.push(start);
        drain();
      });
    },
  };
}

export function useNetworkFileInspections(files: NetworkFilePick[], enabled: boolean) {
  const client = useQueryClient();
  const queue = useRef<ReturnType<typeof createInspectionQueue> | null>(null);
  if (!queue.current) queue.current = createInspectionQueue();
  const corrections = useRef(new Map<string, NetworkFileInspection>());
  const unique = [...new Map(files.map(file => [networkInspectionKey(file.absolute_path, file.maquina), file])).values()];
  function mergeCorrection(item: NetworkFileInspection): NetworkFileInspection {
    const corrected = corrections.current.get(networkInspectionKey(item.absolute_path, item.maquina));
    return corrected && corrected.inspection_token === item.inspection_token &&
      (corrected.feedback_revision ?? 0) >= (item.feedback_revision ?? 0) ? corrected : item;
  }
  // Uma consulta por arquivo: remover um item desmonta apenas o seu observador.
  // Os demais mantêm resultado, posição na fila e requisição em andamento.
  const queries = useQueries({ queries: enabled ? unique.map(file => ({
    queryKey: queryKey(file),
    queryFn: ({ signal }: { signal: AbortSignal }) => queue.current!.run(signal, async () => {
      const result = await inspectNetworkFiles([file], { signal });
      return mergeCorrection(result.files[0]!);
    }),
    staleTime: 60_000,
    retry: false as const,
    refetchOnWindowFocus: false as const,
  })) : [] });
  const inspected = queries.flatMap(query => query.data ? [query.data] : []);
  const failed = queries.find(query => query.isError);
  function acceptCorrection(updated: NetworkFileInspection) {
    corrections.current.set(networkInspectionKey(updated.absolute_path, updated.maquina), updated);
    client.setQueryData(queryKey(updated), updated);
    // Não invalida o lote: a próxima abertura pode consultar o novo aprendizado.
  }
  async function refetch() {
    queue.current!.reset();
    // Preserva análises bem-sucedidas, inclusive as correções humanas.
    await Promise.all(queries.filter(query => query.isError || query.data?.status === "error").map(query => query.refetch()));
  }
  if (!enabled) queue.current.reset();
  return {
    data: inspected.length ? { files: inspected } : undefined,
    total: unique.length,
    completed: inspected.length,
    isFetching: queries.some(query => query.isFetching),
    isError: !!failed,
    error: failed?.error ?? new Error("Não foi possível verificar os arquivos."),
    isSuccess: enabled && queries.every(query => query.isSuccess),
    acceptCorrection,
    refetch,
  };
}
