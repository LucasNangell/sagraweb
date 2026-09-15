import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  connectEmailExchange,
  fetchDeputadoEmails,
  fetchEmailConfig,
  fetchEmailFolders,
  fetchEmailInbox,
  fetchEmailNotificationStatus,
  fetchEmailPendencias,
  fetchEmailProofFiles,
  fetchEmailSendPlan,
  fetchProtocoloLookup,
  fetchPtHtml,
  postEmailAndamento,
  postEmailMarkRead,
  postEmailPendenciaAndamento,
  postEmailSaveMht,
  postEmailSendPt,
  saveEmailConfig,
} from "@/api/email";
import { queryKeys } from "@/api/query-keys";

const EMAIL_SETOR = "SEFOC";
const INBOX_POLL_MS = 15_000;

export function useEmailConfig() {
  return useQuery({
    queryKey: queryKeys.email.config,
    queryFn: fetchEmailConfig,
    staleTime: 30_000,
  });
}

export function useEmailInbox(enabled = true, refreshIntervalSec = INBOX_POLL_MS) {
  const pollMs = Math.max(3000, Math.min(refreshIntervalSec, 120_000));
  return useQuery({
    queryKey: queryKeys.email.inbox,
    queryFn: fetchEmailInbox,
    enabled,
    refetchInterval: enabled ? pollMs : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    /** Mantém a última lista na tela se um refresh falhar (ex.: Exchange indisponível). */
    placeholderData: (previous) => previous,
  });
}

export function useEmailPendencias(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.email.pendencias(EMAIL_SETOR),
    queryFn: () => fetchEmailPendencias(EMAIL_SETOR),
    enabled,
    staleTime: 15_000,
  });
}

export function useEmailNotificationStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.email.notificationStatus(EMAIL_SETOR),
    queryFn: () => fetchEmailNotificationStatus(EMAIL_SETOR),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 10_000,
  });
}

export function usePtHtml(
  ano: number | null,
  os: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey:
      enabled && ano != null && os != null
        ? queryKeys.email.ptHtml(ano, os)
        : ["email", "ptHtml", "idle"],
    queryFn: () => fetchPtHtml(ano!, os!),
    enabled: enabled && ano != null && os != null,
    retry: false,
  });
}

export function useEmailProofFiles(
  ano: number | null,
  os: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      enabled && ano != null && os != null
        ? queryKeys.email.proofFiles(ano, os)
        : ["email", "proofFiles", "idle"],
    queryFn: () => fetchEmailProofFiles(ano!, os!),
    enabled: enabled && ano != null && os != null,
    retry: false,
  });
}

export function usePendenciaProtocolo(ano: number | null, os: number | null) {
  return useQuery({
    queryKey:
      ano != null && os != null
        ? queryKeys.email.protocolo(ano, os)
        : ["email", "protocolo", "idle"],
    queryFn: () => fetchProtocoloLookup(os!, ano!),
    enabled: ano != null && os != null,
    staleTime: 60_000,
  });
}

export function useDeputadoEmailsQuery(
  nomeUsuario: string | null | undefined,
  os: number | null,
  ano: number | null,
  enabled: boolean,
) {
  const nome = nomeUsuario?.trim() ?? "";
  return useQuery({
    queryKey:
      enabled && nome.length >= 3 && os != null && ano != null
        ? queryKeys.email.deputadoEmails(nome, ano, os)
        : ["email", "deputadoEmails", "idle"],
    queryFn: () => fetchDeputadoEmails(nome, os!, ano!),
    enabled: enabled && nome.length >= 3 && os != null && ano != null,
    staleTime: 60_000,
  });
}

export function useEmailMutations() {
  const qc = useQueryClient();

  const invalidateInbox = () =>
    void qc.invalidateQueries({ queryKey: queryKeys.email.inbox });

  const invalidatePendencias = () =>
    void qc.invalidateQueries({
      queryKey: queryKeys.email.pendencias(EMAIL_SETOR),
    });

  const andamentoMutation = useMutation({
    mutationFn: postEmailAndamento,
    onSuccess: () => {
      invalidateInbox();
      void qc.invalidateQueries({
        queryKey: queryKeys.email.notificationStatus(EMAIL_SETOR),
      });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: postEmailMarkRead,
    onSuccess: invalidateInbox,
  });

  const sendPtMutation = useMutation({
    mutationFn: postEmailSendPt,
    onSuccess: () => {
      invalidatePendencias();
      void qc.invalidateQueries({
        queryKey: queryKeys.email.notificationStatus(EMAIL_SETOR),
      });
    },
  });

  const pendenciaAndamentoMutation = useMutation({
    mutationFn: postEmailPendenciaAndamento,
    onSuccess: () => {
      invalidatePendencias();
      void qc.invalidateQueries({
        queryKey: queryKeys.email.notificationStatus(EMAIL_SETOR),
      });
    },
  });

  const saveEmailMhtMutation = useMutation({
    mutationFn: postEmailSaveMht,
  });

  return {
    andamentoMutation,
    markReadMutation,
    sendPtMutation,
    pendenciaAndamentoMutation,
    saveEmailMhtMutation,
  };
}

export function useEmailConfigMutations() {
  const qc = useQueryClient();

  const invalidateConfig = () =>
    void qc.invalidateQueries({ queryKey: queryKeys.email.config });

  const invalidateInbox = () =>
    void qc.invalidateQueries({ queryKey: queryKeys.email.inbox });

  const connectMutation = useMutation({
    mutationFn: connectEmailExchange,
  });

  const foldersMutation = useMutation({
    mutationFn: fetchEmailFolders,
  });

  const saveMutation = useMutation({
    mutationFn: saveEmailConfig,
    onSuccess: () => {
      invalidateConfig();
      invalidateInbox();
      void qc.invalidateQueries({
        queryKey: queryKeys.email.notificationStatus(EMAIL_SETOR),
      });
    },
  });

  const sendPlanMutation = useMutation({
    mutationFn: fetchEmailSendPlan,
  });

  return { connectMutation, foldersMutation, saveMutation, sendPlanMutation };
}
