import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchPcpQueue,
  reorderPcpQueue,
  type PcpQueueItem,
  type PcpReorderPayload,
} from "@/api/pcp";
import { queryKeys } from "@/api/query-keys";

export const PCP_STALE_MS = 15_000;

export function pcpQueueKey(setor: string) {
  return ["pcp", "queue", setor] as const;
}

export function usePcpQueue(setor: string, enabled = true) {
  return useQuery({
    queryKey: pcpQueueKey(setor),
    queryFn: () => fetchPcpQueue(setor),
    enabled: enabled && Boolean(setor),
    staleTime: PCP_STALE_MS,
  });
}

export function usePcpReorderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reorderPcpQueue,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: pcpQueueKey(payload.setor) });
      const previous = queryClient.getQueryData<{ setor: string; items: PcpQueueItem[] }>(
        pcpQueueKey(payload.setor),
      );
      if (previous) {
        const orderMap = new Map(
          payload.items.map((it, idx) => [`${it.nr_os}-${it.ano}`, idx]),
        );
        const reordered = [...previous.items].sort((a, b) => {
          const ka = orderMap.get(`${a.nr_os}-${a.ano}`) ?? 9999;
          const kb = orderMap.get(`${b.nr_os}-${b.ano}`) ?? 9999;
          return ka - kb;
        });
        queryClient.setQueryData(pcpQueueKey(payload.setor), {
          ...previous,
          items: reordered,
        });
      }
      return { previous, setor: payload.setor };
    },
    onError: (_err, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(pcpQueueKey(context.setor), context.previous);
      }
    },
    onSettled: (_data, _err, payload) => {
      void queryClient.invalidateQueries({ queryKey: pcpQueueKey(payload.setor) });
    },
  });
}
