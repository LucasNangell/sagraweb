import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adicionarOsGravacaoPendente,
  adjustGravacaoPendenteCotaDetalhes,
  adjustGravacaoPendenteCotaInicial,
  deleteGravacaoPendenteControle,
  enviarGravacaoPendenteParaExterna,
  fetchGravacaoPendenteConfigDetalhes,
  fetchGravacaoPendenteDetail,
  fetchGravacaoPendenteFornecedores,
  fetchGravacaoPendenteHistorico,
  fetchGravacaoPendenteOsList,
  patchGravacaoPendenteControle,
  patchGravacaoPendenteObservacao,
  patchGravacaoPendentePagamentoNf,
  putGravacaoPendenteFornecedorCotas,
  putGravacaoPendenteMaquinasConfig,
  removerOsGravacaoPendente,
  updateGravacaoPendenteArquivos,
  type GravacaoPendenteControleUpdateBody,
  type GravacaoPendenteAdicionarBody,
  type GravacaoPendenteDetail,
  type GravacaoPendenteCotaAdjustMode,
  type GravacaoPendenteListFilters,
  type GravacaoPendenteMaquinaPrecoItem,
} from "@/api/gravacaoPendente";
import { combineDetailResults } from "@/api/hooks/combineDetailResults";
import { queryKeys } from "@/api/query-keys";

export function useGravacaoPendenteOsList(
  filters: GravacaoPendenteListFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.list(filters),
    queryFn: () => fetchGravacaoPendenteOsList(filters),
    enabled,
    staleTime: 15_000,
  });
}

export function useGravacaoPendenteHasItems(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.list({ badge: true, limit: 1 }),
    queryFn: () => fetchGravacaoPendenteOsList({ limit: 1 }),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 10_000,
    select: (data) => (data.total ?? data.items.length) > 0,
  });
}

export function useGravacaoPendenteDetail(
  ano: number | null,
  nrOs: number | null,
  enabled = true,
  gravacaoPendenteId: number | null = null,
) {
  return useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.gravacaoPendente.detail(ano, nrOs, gravacaoPendenteId)
        : ["gravacaoPendente", "detail", "none"],
    queryFn: () => fetchGravacaoPendenteDetail(ano!, nrOs!, gravacaoPendenteId),
    enabled: enabled && ano != null && nrOs != null,
    staleTime: 10_000,
  });
}

/** Detalhes de várias sessões da mesma OS (card agrupado), com as mesmas query keys. */
export function useGravacaoPendenteDetails(
  ano: number | null,
  nrOs: number | null,
  gravacaoPendenteIds: number[],
  enabled = true,
) {
  return useQueries({
    queries: gravacaoPendenteIds.map((gravacaoPendenteId) => ({
      queryKey:
        ano != null && nrOs != null
          ? queryKeys.gravacaoPendente.detail(ano, nrOs, gravacaoPendenteId)
          : (["gravacaoPendente", "detail", "none", gravacaoPendenteId] as const),
      queryFn: () => fetchGravacaoPendenteDetail(ano!, nrOs!, gravacaoPendenteId),
      enabled: enabled && ano != null && nrOs != null,
      staleTime: 10_000,
    })),
    combine: combineDetailResults<GravacaoPendenteDetail>,
  });
}

export function useGravacaoPendenteHistorico(limit = 100, enabled = true) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.historico(limit),
    queryFn: () => fetchGravacaoPendenteHistorico(limit),
    enabled,
    staleTime: 30_000,
  });
}

export function useGravacaoPendenteFornecedores(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.fornecedores,
    queryFn: () => fetchGravacaoPendenteFornecedores(),
    enabled,
    staleTime: 60_000,
  });
}

export function useGravacaoPendenteConfigDetalhes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gravacaoPendente.configDetalhes,
    queryFn: () => fetchGravacaoPendenteConfigDetalhes(),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useAdjustGravacaoPendenteCotaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (delta: 1 | -1) => adjustGravacaoPendenteCotaInicial(delta),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useAdjustGravacaoPendenteCotaDetalhesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      mode: GravacaoPendenteCotaAdjustMode;
      valor: number;
      observacao: string;
    }) => adjustGravacaoPendenteCotaDetalhes(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function usePutGravacaoPendenteMaquinasConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (maquinas: GravacaoPendenteMaquinaPrecoItem[]) =>
      putGravacaoPendenteMaquinasConfig(maquinas),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.configDetalhes,
      });
    },
  });
}

export function usePutGravacaoPendenteFornecedorCotasMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      items: {
        ponto: string;
        maquina: string;
        cota_chapas: number;
        preco_chapa?: number;
      }[],
    ) => putGravacaoPendenteFornecedorCotas(items),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.configDetalhes,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.historico(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function usePatchGravacaoPendentePagamentoNfMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      gravacaoExternaId,
      pagamento_nf_em,
    }: {
      gravacaoExternaId: number;
      pagamento_nf_em: string | null;
    }) => patchGravacaoPendentePagamentoNf(gravacaoExternaId, pagamento_nf_em),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.historico(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function usePatchGravacaoPendenteControleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      gravacaoPendenteId,
      body,
    }: {
      gravacaoPendenteId: number;
      body: GravacaoPendenteControleUpdateBody;
    }) => patchGravacaoPendenteControle(gravacaoPendenteId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.historico(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useDeleteGravacaoPendenteControleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gravacaoPendenteId: number) =>
      deleteGravacaoPendenteControle(gravacaoPendenteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useEnviarGravacaoPendenteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      fornecedorPonto,
      gravacaoPendenteId,
      gravacaoPendenteIds,
      maquinas,
    }: {
      ano: number;
      nrOs: number;
      fornecedorPonto?: string | null;
      gravacaoPendenteId?: number | null;
      gravacaoPendenteIds?: number[];
      maquinas?: string[];
    }) =>
      enviarGravacaoPendenteParaExterna(ano, nrOs, {
        fornecedorPonto,
        gravacaoPendenteId,
        gravacaoPendenteIds,
        maquinas,
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.detail(vars.ano, vars.nrOs, vars.gravacaoPendenteId),
      });
      for (const id of vars.gravacaoPendenteIds ?? []) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.gravacaoPendente.detail(vars.ano, vars.nrOs, id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
    },
  });
}

export function useAdicionarOsGravacaoPendenteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      body,
    }: {
      ano: number;
      nrOs: number;
      body: GravacaoPendenteAdicionarBody;
    }) => adicionarOsGravacaoPendente(ano, nrOs, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useRemoverOsGravacaoPendenteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gravacaoPendenteId: number) =>
      removerOsGravacaoPendente(gravacaoPendenteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function usePatchGravacaoPendenteObservacaoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      observacao,
      gravacaoPendenteId,
    }: {
      ano: number;
      nrOs: number;
      observacao: string;
      gravacaoPendenteId?: number | null;
    }) => patchGravacaoPendenteObservacao(ano, nrOs, observacao, gravacaoPendenteId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.detail(vars.ano, vars.nrOs, vars.gravacaoPendenteId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useUpdateGravacaoPendenteArquivosMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      arquivos,
      chapas,
      gravacaoPendenteId,
    }: {
      ano: number;
      nrOs: number;
      arquivos: { absolute_path: string; nome: string; maquina?: string | null }[];
      chapas?: { maquina: string; quantidade: number }[];
      gravacaoPendenteId?: number | null;
    }) => updateGravacaoPendenteArquivos(ano, nrOs, arquivos, chapas, gravacaoPendenteId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.detail(vars.ano, vars.nrOs, vars.gravacaoPendenteId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}
