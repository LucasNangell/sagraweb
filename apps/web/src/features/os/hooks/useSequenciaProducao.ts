import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSequenciaProducaoDocx,
  fetchSequenciaProducao,
  saveSequenciaProducao,
  type SequenciaProducaoDraft,
} from "@/api/sequenciaProducao";
import { queryKeys } from "@/api/query-keys";

export function useSequenciaProducao(
  ano: number,
  osId: number,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const queryKey = queryKeys.os.sequenciaProducao(ano, osId);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSequenciaProducao(ano, osId),
    enabled,
  });

  const saveMutation = useMutation({
    mutationFn: (draft: SequenciaProducaoDraft) =>
      saveSequenciaProducao(ano, osId, draft),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => fetchSequenciaProducao(ano, osId, { regenerate: true }),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
    },
  });

  const createDocxMutation = useMutation({
    mutationFn: (draft: SequenciaProducaoDraft) =>
      createSequenciaProducaoDocx(ano, osId, draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });

  return {
    query,
    saveMutation,
    regenerateMutation,
    createDocxMutation,
  };
}
