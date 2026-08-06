import { useEffect, useRef, useState } from "react";

import {
  supportWebSocketHub,
  type SupportHubStatus,
} from "@/features/support/supportWebSocketHub";

interface UseSupportWebSocketHubOptions {
  ponto: string | null;
  enabled?: boolean;
  onMessage?: (data: unknown) => void;
}

/** Hook fino sobre o hub singleton — uma conexão WS por aba para suporte. */
export function useSupportWebSocketHub({
  ponto,
  enabled = true,
  onMessage,
}: UseSupportWebSocketHubOptions) {
  const [status, setStatus] = useState<SupportHubStatus>(supportWebSocketHub.getStatus());
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled || !ponto) {
      return;
    }
    supportWebSocketHub.acquire(ponto);
    const removeMsg = supportWebSocketHub.addListener((data) => {
      onMessageRef.current?.(data);
    });
    const removeStatus = supportWebSocketHub.addStatusListener(setStatus);
    return () => {
      removeMsg();
      removeStatus();
      supportWebSocketHub.release();
    };
  }, [enabled, ponto]);

  return {
    status,
    send: (data: unknown) => supportWebSocketHub.send(data),
    subscribe: (ticketId: number, reason?: string) =>
      supportWebSocketHub.subscribe(ticketId, reason),
    unsubscribe: (ticketId: number, reason?: string) =>
      supportWebSocketHub.unsubscribe(ticketId, reason),
    isSubscribed: (ticketId: number) => supportWebSocketHub.isSubscribed(ticketId),
  };
}
