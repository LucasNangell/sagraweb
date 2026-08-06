import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { queryKeys } from "@/api/query-keys";
import { useGravacaoExternaUiStore } from "@/features/gravacao-externa/gravacaoExternaUiStore";
import {
  extractGravacaoOsFromWs,
  handleGravacaoExternaMensagemWs,
  sameGravacaoOs,
  type GravacaoExternaWsPayload,
} from "@/features/gravacao-externa/utils/gravacaoExternaNotificationHandlers";
import type { WebSocketStatus } from "@/hooks/useSagraWebSocket";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

const GRAVACAO_EXTERNA_SITUACAO = "Gravação Externa";

export interface UseGravacaoExternaRealtimeOptions {
  /** OS cuja conversa está aberta (chat). */
  chatAno?: number | null;
  chatNrOs?: number | null;
}

function invalidateGravacaoExternaList(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.gravacaoExterna.prefix,
  });
}

export function useGravacaoExternaRealtime(
  ano: number | null,
  nrOs: number | null,
  enabled = true,
  ponto: string | null = null,
  options: UseGravacaoExternaRealtimeOptions = {},
) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const setViewingOs = useGravacaoExternaUiStore((s) => s.setViewingOs);

  const chatAno = options.chatAno ?? null;
  const chatNrOs = options.chatNrOs ?? null;

  const anoRef = useRef(ano);
  const nrOsRef = useRef(nrOs);
  const chatAnoRef = useRef(chatAno);
  const chatNrOsRef = useRef(chatNrOs);
  anoRef.current = ano;
  nrOsRef.current = nrOs;
  chatAnoRef.current = chatAno;
  chatNrOsRef.current = chatNrOs;

  useEffect(() => {
    if (!enabled || chatAno == null || chatNrOs == null) {
      setViewingOs(null, null);
      return;
    }
    setViewingOs(chatAno, chatNrOs);
    return () => setViewingOs(null, null);
  }, [chatAno, chatNrOs, enabled, setViewingOs]);

  useEffect(() => {
    if (!enabled || ano == null || nrOs == null) {
      setToast(null);
    }
  }, [enabled, ano, nrOs]);

  const clearToast = useCallback(() => setToast(null), []);

  const handleLifecycleEvent = useCallback(
    (data: GravacaoExternaWsPayload, msgType: string) => {
      const os = extractGravacaoOsFromWs(data);
      const matchesOpenOs =
        os != null &&
        sameGravacaoOs(anoRef.current, nrOsRef.current, os.ano, os.nrOs);

      if (matchesOpenOs && os != null) {
        void queryClient.refetchQueries({
          queryKey: queryKeys.gravacaoExterna.detail(os.ano, os.nrOs),
          type: "all",
        });

        if (msgType === "gravacao_externa_arquivos_atualizados") {
          setToast("Os arquivos desta OS foram atualizados.");
        }
      }

      invalidateGravacaoExternaList(queryClient);
    },
    [queryClient],
  );

  const onMessage = useCallback(
    (data: GravacaoExternaWsPayload) => {
      const msgType = data.type ?? "";

      if (msgType === "system_update") {
        const situacao = (data as GravacaoExternaWsPayload & { situacao?: string }).situacao;
        if (situacao === GRAVACAO_EXTERNA_SITUACAO) {
          invalidateGravacaoExternaList(queryClient);
        }
        return;
      }

      if (
        msgType === "gravacao_externa_message" ||
        (msgType === "notification_new" && data.action === "gravacao_externa_mensagem")
      ) {
        const scopeAno = chatAnoRef.current ?? anoRef.current;
        const scopeNrOs = chatNrOsRef.current ?? nrOsRef.current;
        void handleGravacaoExternaMensagemWs(queryClient, data, {
          ano: scopeAno,
          nrOs: scopeNrOs,
        });
        return;
      }

      if (!msgType.startsWith("gravacao_externa_")) {
        return;
      }

      handleLifecycleEvent(data, msgType);
    },
    [handleLifecycleEvent, queryClient],
  );

  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";

  const { status: wsStatus } = useSagraWebSocket<GravacaoExternaWsPayload>({
    path: wsPath,
    enabled: enabled && Boolean(ponto),
    onMessage,
  });

  return { toast, clearToast, wsStatus: wsStatus as WebSocketStatus };
}
