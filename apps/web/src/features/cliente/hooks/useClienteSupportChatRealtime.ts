import { useQueryClient } from "@tanstack/react-query";

import { useCallback, useEffect, useRef, useState } from "react";



import { queryKeys } from "@/api/query-keys";

import type { SupportThreadMessage } from "@/api/support";

import type { RemoteTypingState } from "@/features/support/hooks/useSupportChatRealtime";

import {

  applyThreadMessageToCache,

  applyTicketResolvedToCache,

} from "@/features/support/utils/supportThreadCache";

import type { WebSocketStatus } from "@/hooks/useSagraWebSocket";

import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";



interface SupportChatWsPayload {

  type?: string;

  ticket_id?: number;

  cliente_id?: number;

  message?: SupportThreadMessage;

  ticket_status?: string;

  author_role?: string;

  author_label?: string;

  typing?: boolean;

}



interface UseClienteSupportChatRealtimeOptions {

  ticketId: number | null;

  clienteId: number | null;

  authorLabel: string;

  enabled: boolean;

}



const TYPING_IDLE_MS = 2000;

const TYPING_HIDE_MS = 3000;



export function useClienteSupportChatRealtime({

  ticketId,

  clienteId,

  authorLabel,

  enabled,

}: UseClienteSupportChatRealtimeOptions) {

  const qc = useQueryClient();

  const [remoteTyping, setRemoteTyping] = useState<RemoteTypingState | null>(null);

  const typingActiveRef = useRef(false);

  const typingIdleTimerRef = useRef<number | null>(null);

  const typingHideTimerRef = useRef<number | null>(null);

  const subscribedTicketRef = useRef<number | null>(null);



  const ticketQueryKey =

    ticketId != null

      ? queryKeys.support.clienteTicket(ticketId)

      : ["support", "clienteTicket", "idle"];



  const clearTypingIdleTimer = useCallback(() => {

    if (typingIdleTimerRef.current != null) {

      window.clearTimeout(typingIdleTimerRef.current);

      typingIdleTimerRef.current = null;

    }

  }, []);



  const clearTypingHideTimer = useCallback(() => {

    if (typingHideTimerRef.current != null) {

      window.clearTimeout(typingHideTimerRef.current);

      typingHideTimerRef.current = null;

    }

  }, []);



  const { status, send } = useSagraWebSocket<SupportChatWsPayload>({

    path: "/ws",

    enabled: enabled && Boolean(clienteId),

    onMessage: (data) => {

      if (!ticketId || data.ticket_id !== ticketId) {

        return;

      }

      if (data.cliente_id != null && clienteId != null && data.cliente_id !== clienteId) {

        return;

      }



      if (data.type === "support_chat_message") {

        setRemoteTyping(null);

        clearTypingHideTimer();

        if (data.message) {

          applyThreadMessageToCache(qc, ticketQueryKey, data.message, data.ticket_status);

        } else {

          void qc.invalidateQueries({ queryKey: [...ticketQueryKey] });

        }

        return;

      }



      if (data.type === "support_chat_typing") {

        if (data.author_role === "cliente") {

          return;

        }

        if (data.typing) {

          setRemoteTyping({

            role: "admin",

            label: data.author_label?.trim() || "Suporte",

          });

          clearTypingHideTimer();

          typingHideTimerRef.current = window.setTimeout(() => {

            setRemoteTyping(null);

          }, TYPING_HIDE_MS);

        } else {

          setRemoteTyping(null);

          clearTypingHideTimer();

        }

        return;

      }



      if (data.type === "support_chat_resolved") {

        setRemoteTyping(null);

        applyTicketResolvedToCache(qc, ticketQueryKey);

      }

    },

  });



  const emitTyping = useCallback(

    (active: boolean) => {

      if (!ticketId) {

        return;

      }

      send({

        type: active ? "support_typing" : "support_typing_stop",

        ticket_id: ticketId,

        author_role: "cliente",

        author_label: authorLabel,

      });

    },

    [authorLabel, send, ticketId],

  );



  const stopTyping = useCallback(() => {

    clearTypingIdleTimer();

    if (typingActiveRef.current) {

      typingActiveRef.current = false;

      emitTyping(false);

    }

  }, [clearTypingIdleTimer, emitTyping]);



  const handleInputActivity = useCallback(() => {

    if (!ticketId || !enabled) {

      return;

    }

    if (!typingActiveRef.current) {

      typingActiveRef.current = true;

      emitTyping(true);

    }

    clearTypingIdleTimer();

    typingIdleTimerRef.current = window.setTimeout(() => {

      stopTyping();

    }, TYPING_IDLE_MS);

  }, [clearTypingIdleTimer, emitTyping, enabled, stopTyping, ticketId]);



  const sendSubscribe = useCallback(() => {

    if (!ticketId) {

      return;

    }

    const sent = send({ type: "support_subscribe", ticket_id: ticketId });

    if (sent) {

      subscribedTicketRef.current = ticketId;

    }

  }, [send, ticketId]);



  useEffect(() => {

    if (!enabled || !ticketId || status !== "connected") {

      return;

    }

    sendSubscribe();

    const retryTimer = window.setTimeout(sendSubscribe, 400);

    return () => {

      window.clearTimeout(retryTimer);

      if (subscribedTicketRef.current === ticketId) {

        send({ type: "support_unsubscribe", ticket_id: ticketId });

        subscribedTicketRef.current = null;

      }

      stopTyping();

    };

  }, [enabled, send, sendSubscribe, status, stopTyping, ticketId]);



  useEffect(

    () => () => {

      clearTypingIdleTimer();

      clearTypingHideTimer();

      stopTyping();

    },

    [clearTypingHideTimer, clearTypingIdleTimer, stopTyping],

  );



  return {

    remoteTyping,

    handleInputActivity,

    stopTyping,

    wsStatus: status as WebSocketStatus,

  };

}


