import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { queryKeys } from "@/api/query-keys";
import type { SupportThreadMessage } from "@/api/support";
import {
  applyThreadMessageToCache,
  applyTicketResolvedToCache,
  invalidateSupportListQueries,
} from "@/features/support/utils/supportThreadCache";
import { logSupportWsEvent } from "@/features/support/utils/normalizeSupportWsEvent";
import {
  shouldClearSubscription,
  shouldSkipSubscribe,
  ticketToUnsubscribeBeforeChange,
} from "@/features/support/utils/userSupportSubscribeLogic";
import { supportWsLog, supportWsLogSend } from "@/lib/supportWsDebug";
import type { WebSocketStatus } from "@/hooks/useSagraWebSocket";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

export type SupportChatRole = "usuario" | "admin" | "assigned";

interface SupportChatWsPayload {
  type?: string;
  ticket_id?: number;
  owner_ponto?: string;
  message?: SupportThreadMessage;
  ticket_status?: string;
  author_role?: SupportChatRole;
  author_label?: string;
  typing?: boolean;
  action?: string;
}

export interface RemoteTypingState {
  role: SupportChatRole;
  label: string;
}

interface UseSupportChatRealtimeOptions {
  ticketId: number | null;
  ponto: string | null;
  role: SupportChatRole;
  authorLabel: string;
  enabled: boolean;
  ticketQueryKey: readonly unknown[];
  debugScope?: string;
  onSupportIncoming?: (ticketId: number | null) => void;
}

const TYPING_IDLE_MS = 2000;
const TYPING_HIDE_MS = 3000;
const SUBSCRIBE_RETRY_MS = 400;

export function useSupportChatRealtime({
  ticketId,
  ponto,
  role,
  authorLabel,
  enabled,
  ticketQueryKey,
  debugScope = "ADMIN SUPPORT WS",
  onSupportIncoming,
}: UseSupportChatRealtimeOptions) {
  const qc = useQueryClient();
  const [remoteTyping, setRemoteTyping] = useState<RemoteTypingState | null>(null);
  const typingActiveRef = useRef(false);
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingHideTimerRef = useRef<number | null>(null);
  const ticketIdRef = useRef(ticketId);
  const subscribedTicketRef = useRef<number | null>(null);
  const subscribeRetryRef = useRef<number | null>(null);
  const sendRef = useRef<(data: unknown) => boolean>(() => false);
  const wsStatusRef = useRef<WebSocketStatus>("disconnected");
  const onSupportIncomingRef = useRef(onSupportIncoming);
  onSupportIncomingRef.current = onSupportIncoming;

  ticketIdRef.current = ticketId;

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

  const clearSubscribeRetry = useCallback(() => {
    if (subscribeRetryRef.current != null) {
      window.clearTimeout(subscribeRetryRef.current);
      subscribeRetryRef.current = null;
    }
  }, []);

  const handleWsData = useCallback(
    (data: SupportChatWsPayload) => {
      const event = logSupportWsEvent(debugScope, data);
      const activeTicketId = ticketIdRef.current;
      const eventTicketId = event.ticketId ?? event.message?.TicketId ?? null;

      if (event.type === "notification_new" && event.action === "support_incoming") {
        onSupportIncomingRef.current?.(eventTicketId);
        if (activeTicketId != null && eventTicketId === activeTicketId) {
          void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
          invalidateSupportListQueries(qc);
        }
        return;
      }

      if (event.type === "notification_new" && event.action === "support_reply") {
        if (activeTicketId != null && eventTicketId === activeTicketId) {
          void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
          invalidateSupportListQueries(qc);
        }
        return;
      }

      if (!activeTicketId || eventTicketId == null || eventTicketId !== activeTicketId) {
        return;
      }

      if (event.type === "support_chat_message") {
        setRemoteTyping(null);
        clearTypingHideTimer();
        supportWsLog(debugScope, "MESSAGE RECEIVED", {
          ticket: eventTicketId,
          messageId: event.messageId,
        });
        if (event.message) {
          const mergeResult = applyThreadMessageToCache(
            qc,
            ticketQueryKey,
            event.message,
            event.ticketStatus ?? undefined,
          );
          if (mergeResult !== "appended") {
            void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
          }
        } else {
          void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
        }
        invalidateSupportListQueries(qc);
        return;
      }

      if (event.type === "support_chat_typing") {
        if (event.authorRole === role) {
          return;
        }
        if (event.typing) {
          setRemoteTyping({
            role: (event.authorRole ?? "admin") as SupportChatRole,
            label:
              event.authorLabel?.trim() ||
              (event.authorRole === "admin" ? "Suporte" : "Usuário"),
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

      if (event.type === "support_chat_resolved") {
        setRemoteTyping(null);
        applyTicketResolvedToCache(qc, ticketQueryKey);
        invalidateSupportListQueries(qc);
      }
    },
    [clearTypingHideTimer, debugScope, qc, role, ticketQueryKey],
  );

  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";
  const wsEnabled = enabled && Boolean(ponto);

  const { status, send } = useSagraWebSocket<SupportChatWsPayload>({
    path: wsPath,
    enabled: wsEnabled,
    onOpen: () => {
      subscribedTicketRef.current = null;
      supportWsLog(debugScope, "WS OPEN", { path: wsPath, ticketId: ticketIdRef.current });
    },
    onMessage: handleWsData,
  });

  sendRef.current = send;
  wsStatusRef.current = status as WebSocketStatus;

  const sendSubscribe = useCallback(
    (tid: number, reason: string) => {
      const payload = { type: "support_subscribe", ticket_id: tid };
      const sent = sendRef.current(payload);
      supportWsLogSend(debugScope, payload, sent);
      supportWsLog(debugScope, `SUBSCRIBE ${reason}`, { ticket: tid, sent });
      if (sent) {
        subscribedTicketRef.current = tid;
      }
      return sent;
    },
    [debugScope],
  );

  const sendUnsubscribe = useCallback(
    (tid: number, reason: string) => {
      if (subscribedTicketRef.current !== tid) {
        return;
      }
      const payload = { type: "support_unsubscribe", ticket_id: tid };
      sendRef.current(payload);
      subscribedTicketRef.current = null;
      supportWsLog(debugScope, `UNSUBSCRIBE ${reason}`, { ticket: tid });
    },
    [debugScope],
  );

  const ensureSubscribed = useCallback(
    (tid: number | null, reason: string) => {
      if (!wsEnabled || wsStatusRef.current !== "connected") {
        return;
      }
      if (shouldClearSubscription(tid)) {
        if (subscribedTicketRef.current != null) {
          sendUnsubscribe(subscribedTicketRef.current, "ticket_cleared");
        }
        return;
      }
      if (shouldSkipSubscribe(subscribedTicketRef.current, tid)) {
        return;
      }
      const prev = ticketToUnsubscribeBeforeChange(subscribedTicketRef.current, tid);
      if (prev != null) {
        sendUnsubscribe(prev, "ticket_change");
      }
      clearSubscribeRetry();
      const sent = sendSubscribe(tid, reason);
      if (!sent) {
        subscribeRetryRef.current = window.setTimeout(() => {
          if (
            ticketIdRef.current === tid &&
            subscribedTicketRef.current !== tid &&
            wsStatusRef.current === "connected"
          ) {
            sendSubscribe(tid, `${reason}_retry`);
          }
        }, SUBSCRIBE_RETRY_MS);
      }
    },
    [clearSubscribeRetry, sendSubscribe, sendUnsubscribe, wsEnabled],
  );

  useEffect(() => {
    if (!wsEnabled) {
      return;
    }
    ensureSubscribed(ticketId, status === "connected" ? "ws_connected" : "ws_pending");
  }, [ensureSubscribed, status, ticketId, wsEnabled]);

  useEffect(() => () => clearSubscribeRetry(), [clearSubscribeRetry]);

  const emitTyping = useCallback(
    (active: boolean) => {
      if (!ticketId) {
        return;
      }
      const payload = {
        type: active ? "support_typing" : "support_typing_stop",
        ticket_id: ticketId,
        author_role: role,
        author_label: authorLabel,
      };
      supportWsLogSend(debugScope, payload, send(payload));
    },
    [authorLabel, debugScope, role, send, ticketId],
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
    typingIdleTimerRef.current = window.setTimeout(() => stopTyping(), TYPING_IDLE_MS);
  }, [clearTypingIdleTimer, emitTyping, enabled, stopTyping, ticketId]);

  useEffect(() => {
    if (!enabled) {
      stopTyping();
      setRemoteTyping(null);
    }
  }, [enabled, stopTyping]);

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

export function supportTicketQueryKey(
  role: SupportChatRole,
  ticketId: number,
): readonly unknown[] {
  if (role === "admin") {
    return queryKeys.support.adminTicket(ticketId);
  }
  if (role === "assigned") {
    return queryKeys.support.assignedTicket(ticketId);
  }
  return queryKeys.support.userTicket(ticketId);
}
