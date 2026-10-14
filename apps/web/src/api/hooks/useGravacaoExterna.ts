import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  concluirGravacaoExterna,
  fetchGravacaoExternaAguardandoEntrega,
  fetchGravacaoExternaDetail,
  fetchGravacaoExternaMensagens,
  fetchGravacaoExternaOsList,
  iniciarGravacaoExterna,
  lancarEntregaChapas,
  postGravacaoExternaMensagem,
  removerOsGravacaoExterna,
  updateGravacaoExternaArquivos,
  type GravacaoExternaDetail,
  type GravacaoExternaListFilters,
} from "@/api/gravacaoExterna";
import { combineDetailResults } from "@/api/hooks/combineDetailResults";
import { queryKeys } from "@/api/query-keys";
import { applyGravacaoMensagemToCache } from "@/features/gravacao-externa/utils/gravacaoExternaThreadCache";

export const GRAVACAO_EXTERNA_SAFETY_POLL_MS = 15_000;

export interface GravacaoExternaQueryPollOptions {
  refetchInterval?: number | false;
}

export function useGravacaoExternaOsList(
  filters: GravacaoExternaListFilters,
  enabled = true,
  pollOptions: GravacaoExternaQueryPollOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.gravacaoExterna.list(filters),
    queryFn: () => fetchGravacaoExternaOsList(filters),
    enabled,
    staleTime: 15_000,
    refetchInterval: pollOptions.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useGravacaoExternaAguardandoEntrega(
  filters: GravacaoExternaListFilters,
  enabled = true,
  pollOptions: GravacaoExternaQueryPollOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.gravacaoExterna.aguardandoEntrega(filters),
    queryFn: () => fetchGravacaoExternaAguardandoEntrega(filters),
    enabled,
    staleTime: 15_000,
    refetchInterval: pollOptions.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useGravacaoExternaDetail(
  ano: number | null,
  nrOs: number | null,
  enabled = true,
  pollOptions: GravacaoExternaQueryPollOptions = {},
  gravacaoExternaId: number | null = null,
) {
  return useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.gravacaoExterna.detail(ano, nrOs, gravacaoExternaId)
        : ["gravacaoExterna", "detail", "none"],
    queryFn: () => fetchGravacaoExternaDetail(ano!, nrOs!, gravacaoExternaId),
    enabled: enabled && ano != null && nrOs != null,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: pollOptions.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

/** Detalhes de vários envios da mesma OS (card agrupado), com as mesmas query keys. */
export function useGravacaoExternaDetails(
  ano: number | null,
  nrOs: number | null,
  gravacaoExternaIds: number[],
  enabled = true,
  pollOptions: GravacaoExternaQueryPollOptions = {},
) {
  return useQueries({
    queries: gravacaoExternaIds.map((gravacaoExternaId) => ({
      queryKey:
        ano != null && nrOs != null
          ? queryKeys.gravacaoExterna.detail(ano, nrOs, gravacaoExternaId)
          : (["gravacaoExterna", "detail", "none", gravacaoExternaId] as const),
      queryFn: () => fetchGravacaoExternaDetail(ano!, nrOs!, gravacaoExternaId),
      enabled: enabled && ano != null && nrOs != null,
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: pollOptions.refetchInterval ?? false,
      refetchIntervalInBackground: false,
    })),
    combine: combineDetailResults<GravacaoExternaDetail>,
  });
}

export function useGravacaoExternaMensagens(
  ano: number | null,
  nrOs: number | null,
  enabled = true,
  gravacaoExternaId: number | null = null,
) {
  return useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.gravacaoExterna.mensagens(ano, nrOs, gravacaoExternaId)
        : ["gravacaoExterna", "mensagens", "none"],
    queryFn: () => fetchGravacaoExternaMensagens(ano!, nrOs!, gravacaoExternaId),
    enabled: enabled && ano != null && nrOs != null,
    staleTime: 5_000,
  });
}

export function useIniciarGravacaoExternaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ano, nrOs, gravacaoExternaId }: { ano: number; nrOs: number; gravacaoExternaId?: number | null }) =>
      iniciarGravacaoExterna(ano, nrOs, gravacaoExternaId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs, vars.gravacaoExternaId),
      });
    },
  });
}

export function useRemoverOsGravacaoExternaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gravacaoExternaId: number) =>
      removerOsGravacaoExterna(gravacaoExternaId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
    },
  });
}

export function usePostGravacaoExternaMensagemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      mensagem,
      gravacaoExternaId,
    }: {
      ano: number;
      nrOs: number;
      mensagem: string;
      gravacaoExternaId?: number | null;
    }) => postGravacaoExternaMensagem(ano, nrOs, mensagem, gravacaoExternaId),
    onSuccess: (data, vars) => {
      applyGravacaoMensagemToCache(queryClient, vars.ano, vars.nrOs, data, vars.gravacaoExternaId);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs, vars.gravacaoExternaId),
      });
    },
  });
}

export function useConcluirGravacaoExternaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ano, nrOs, gravacaoExternaId }: { ano: number; nrOs: number; gravacaoExternaId?: number | null }) =>
      concluirGravacaoExterna(ano, nrOs, gravacaoExternaId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs, vars.gravacaoExternaId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useLancarEntregaChapasMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      recebidoPorPonto,
      recebidoPorNome,
      gravacaoExternaId,
    }: {
      ano: number;
      nrOs: number;
      recebidoPorPonto: string;
      recebidoPorNome: string;
      gravacaoExternaId?: number | null;
    }) =>
      lancarEntregaChapas(ano, nrOs, {
        recebidoPorPonto,
        recebidoPorNome,
      }, gravacaoExternaId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs, vars.gravacaoExternaId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoPendente.prefix,
      });
    },
  });
}

export function useUpdateGravacaoExternaArquivosMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ano,
      nrOs,
      arquivos,
      gravacaoExternaId,
    }: {
      ano: number;
      nrOs: number;
      arquivos: { absolute_path: string; nome: string; maquina?: string | null }[];
      gravacaoExternaId?: number | null;
    }) => updateGravacaoExternaArquivos(ano, nrOs, arquivos, gravacaoExternaId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs, vars.gravacaoExternaId),
      });
    },
  });
}
