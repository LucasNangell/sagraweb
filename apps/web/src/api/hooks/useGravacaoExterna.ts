import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  concluirGravacaoExterna,
  fetchGravacaoExternaAguardandoEntrega,
  fetchGravacaoExternaDetail,
  fetchGravacaoExternaMensagens,
  fetchGravacaoExternaOsList,
  iniciarGravacaoExterna,
  lancarEntregaChapas,
  postGravacaoExternaMensagem,
  updateGravacaoExternaArquivos,
  type GravacaoExternaListFilters,
} from "@/api/gravacaoExterna";
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
) {
  return useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.gravacaoExterna.detail(ano, nrOs)
        : ["gravacaoExterna", "detail", "none"],
    queryFn: () => fetchGravacaoExternaDetail(ano!, nrOs!),
    enabled: enabled && ano != null && nrOs != null,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: pollOptions.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useGravacaoExternaMensagens(
  ano: number | null,
  nrOs: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.gravacaoExterna.mensagens(ano, nrOs)
        : ["gravacaoExterna", "mensagens", "none"],
    queryFn: () => fetchGravacaoExternaMensagens(ano!, nrOs!),
    enabled: enabled && ano != null && nrOs != null,
    staleTime: 5_000,
  });
}

export function useIniciarGravacaoExternaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ano, nrOs }: { ano: number; nrOs: number }) =>
      iniciarGravacaoExterna(ano, nrOs),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs),
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
    }: {
      ano: number;
      nrOs: number;
      mensagem: string;
    }) => postGravacaoExternaMensagem(ano, nrOs, mensagem),
    onSuccess: (data, vars) => {
      applyGravacaoMensagemToCache(queryClient, vars.ano, vars.nrOs, data);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs),
      });
    },
  });
}

export function useConcluirGravacaoExternaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ano, nrOs }: { ano: number; nrOs: number }) =>
      concluirGravacaoExterna(ano, nrOs),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs),
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
    }: {
      ano: number;
      nrOs: number;
      recebidoPorPonto: string;
      recebidoPorNome: string;
    }) =>
      lancarEntregaChapas(ano, nrOs, {
        recebidoPorPonto,
        recebidoPorNome,
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs),
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
    }: {
      ano: number;
      nrOs: number;
      arquivos: { absolute_path: string; nome: string; maquina?: string | null }[];
    }) => updateGravacaoExternaArquivos(ano, nrOs, arquivos),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.detail(vars.ano, vars.nrOs),
      });
    },
  });
}
