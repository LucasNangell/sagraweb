import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { useGravacaoExternaUiStore } from "@/features/gravacao-externa/gravacaoExternaUiStore";
import {
  handleGravacaoExternaMensagemWs,
  type GravacaoExternaWsPayload,
} from "@/features/gravacao-externa/utils/gravacaoExternaNotificationHandlers";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

export function useGravacaoExternaChatRealtime(
  ano: number,
  nrOs: number,
  ponto: string | null,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const setViewingOs = useGravacaoExternaUiStore((s) => s.setViewingOs);

  useEffect(() => {
    if (enabled) {
      setViewingOs(ano, nrOs);
    } else {
      setViewingOs(null, null);
    }
    return () => setViewingOs(null, null);
  }, [ano, enabled, nrOs, setViewingOs]);

  const onMessage = useCallback(
    (data: GravacaoExternaWsPayload) => {
      void handleGravacaoExternaMensagemWs(queryClient, data, { ano, nrOs });
    },
    [ano, nrOs, queryClient],
  );

  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";

  useSagraWebSocket<GravacaoExternaWsPayload>({
    path: wsPath,
    enabled: enabled && Boolean(ponto),
    onMessage,
  });
}
