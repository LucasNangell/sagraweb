import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { queryKeys } from "@/api/query-keys";
import type { RemoteTypingState } from "@/features/support/hooks/useSupportChatRealtime";
import { SUPPORT_FRONT_FIX_VERSION } from "@/features/support/supportFixVersion";
import { handleSupportReplyNotification } from "@/features/support/utils/supportNotificationHandlers";
import {
  applyThreadMessageToCache,
  applyTicketResolvedToCache,
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

const TYPING_IDLE_MS = 2000;
const TYPING_HIDE_MS = 3000;
const SUBSCRIBE_RETRY_MS = 400;

interface UseUserSupportPageWebSocketOptions {
  ponto: string | null;
  selectedTicketId: number | null;
  authorLabel: string;
  pageEnabled?: boolean;
}

function cleanPonto(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** WebSocket dedicado para /mensagens do usuário (sem hub singleton). */
export function useUserSupportPageWebSocket({
  ponto,
  selectedTicketId,
  authorLabel,
  pageEnabled = true,
}: UseUserSupportPageWebSocketOptions) {
  const qc = useQueryClient();
  const [remoteTyping, setRemoteTyping] = useState<RemoteTypingState | null>(null);
  const typingActiveRef = useRef(false);
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingHideTimerRef = useRef<number | null>(null);
  const subscribedTicketRef = useRef<number | null>(null);
  const subscribeRetryTimerRef = useRef<number | null>(null);
  const selectedTicketRef = useRef(selectedTicketId);
  const sendRef = useRef<(data: unknown) => boolean>(() => false);
  const wsStatusRef = useRef<WebSocketStatus>("disconnected");
  const versionLoggedRef = useRef(false);

  selectedTicketRef.current = selectedTicketId;

  const clearSubscribeRetryTimer = useCallback(() => {
    if (subscribeRetryTimerRef.current != null) {
      window.clearTimeout(subscribeRetryTimerRef.current);
      subscribeRetryTimerRef.current = null;
    }
  }, []);

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

  const wsPath = ponto ? `/ws?ponto=${encodeURIComponent(ponto)}` : "/ws";
  const wsEnabled = pageEnabled && Boolean(ponto);

  const handleWsData = useCallback(
    (data: unknown) => {
      const event = logSupportWsEvent("USER", data);
      const activeTicketId = selectedTicketRef.current;

      if (event.type === "notification_new" || event.action === "support_reply") {
        const target = event.targetPonto ?? event.recipientUserId;
        if (target && ponto && cleanPonto(target) !== cleanPonto(ponto)) {
          return;
        }
        if (event.action === "support_reply") {
          void handleSupportReplyNotification(qc, ponto, {
            type: "notification_new",
            action: "support_reply",
            ticket_id: event.ticketId ?? activeTicketId ?? undefined,
            support_message_id: event.ticketId ?? activeTicketId ?? undefined,
          });
          if (
            activeTicketId != null &&
            event.ticketId != null &&
            event.ticketId === activeTicketId
          ) {
            void qc.refetchQueries({
              queryKey: queryKeys.support.userTicket(activeTicketId),
            });
          }
        }
        return;
      }

      const eventTicketId = event.ticketId;

      if (event.type === "support_chat_message") {
        console.info("[USER SUPPORT MESSAGE RECEIVED]", {
          ticket: eventTicketId,
          selected: activeTicketId,
          messageId: event.messageId,
        });
        if (eventTicketId == null) {
          void qc.invalidateQueries({ queryKey: ["support", "userTickets"] });
          if (activeTicketId != null) {
            void qc.refetchQueries({ queryKey: queryKeys.support.userTicket(activeTicketId) });
          }
          return;
        }
        if (activeTicketId != null && eventTicketId === activeTicketId) {
          const key = queryKeys.support.userTicket(activeTicketId);
          if (event.message) {
            const mergeResult = applyThreadMessageToCache(
              qc,
              key,
              event.message,
              event.ticketStatus ?? undefined,
            );
            if (mergeResult !== "appended") {
              void qc.refetchQueries({ queryKey: key });
            }
          } else {
            void qc.refetchQueries({ queryKey: key });
          }
        }
        void qc.invalidateQueries({ queryKey: ["support", "userTickets"] });
        return;
      }

      if (
        event.type === "support_chat_typing" &&
        eventTicketId != null &&
        activeTicketId != null &&
        eventTicketId === activeTicketId
      ) {
        if (event.authorRole === "usuario") {
          return;
        }
        if (event.typing) {
          setRemoteTyping({ role: "admin", label: event.authorLabel?.trim() || "Suporte" });
          clearTypingHideTimer();
          typingHideTimerRef.current = window.setTimeout(() => setRemoteTyping(null), TYPING_HIDE_MS);
        } else {
          setRemoteTyping(null);
          clearTypingHideTimer();
        }
        return;
      }

      if (
        event.type === "support_chat_resolved" &&
        activeTicketId != null &&
        eventTicketId === activeTicketId
      ) {
        setRemoteTyping(null);
        applyTicketResolvedToCache(qc, queryKeys.support.userTicket(activeTicketId));
        void qc.invalidateQueries({ queryKey: ["support", "userTickets"] });
      }
    },
    [clearTypingHideTimer, ponto, qc],
  );

  const { status, send } = useSagraWebSocket({
    path: wsPath,
    enabled: wsEnabled,
    onOpen: () => {
      subscribedTicketRef.current = null;
      supportWsLog("USER WS OPEN", wsPath, {
        ponto,
        selectedTicketId: selectedTicketRef.current,
      });
    },
    onMessage: handleWsData,
  });

  sendRef.current = send;
  wsStatusRef.current = status as WebSocketStatus;

  const sendSubscribe = useCallback((ticketId: number, reason: string): boolean => {
    const payload = { type: "support_subscribe", ticket_id: ticketId };
    const sent = sendRef.current(payload);
    supportWsLogSend("USER SUPPORT SUBSCRIBE", payload, sent);
    if (sent) {
      subscribedTicketRef.current = ticketId;
    }
    return sent;
  }, []);

  const sendUnsubscribe = useCallback((ticketId: number, reason: string) => {
    if (subscribedTicketRef.current !== ticketId) {
      return;
    }
    sendRef.current({ type: "support_unsubscribe", ticket_id: ticketId });
    subscribedTicketRef.current = null;
    supportWsLog("USER SUPPORT UNSUBSCRIBE", reason, { ticket: ticketId });
  }, []);

  const ensureSubscribed = useCallback(
    (ticketId: number | null, reason: string) => {
      if (!wsEnabled || wsStatusRef.current !== "connected") {
        return;
      }
      if (shouldClearSubscription(ticketId)) {
        if (subscribedTicketRef.current != null) {
          sendUnsubscribe(subscribedTicketRef.current, "ticket_cleared");
        }
        return;
      }
      if (shouldSkipSubscribe(subscribedTicketRef.current, ticketId)) {
        return;
      }
      const prev = ticketToUnsubscribeBeforeChange(subscribedTicketRef.current, ticketId);
      if (prev != null) {
        sendUnsubscribe(prev, "ticket_change");
      }
      clearSubscribeRetryTimer();
      const sent = sendSubscribe(ticketId, reason);
      if (!sent) {
        subscribeRetryTimerRef.current = window.setTimeout(() => {
          if (
            selectedTicketRef.current === ticketId &&
            subscribedTicketRef.current !== ticketId &&
            wsStatusRef.current === "connected"
          ) {
            sendSubscribe(ticketId, `${reason}_retry`);
          }
        }, SUBSCRIBE_RETRY_MS);
      }
    },
    [clearSubscribeRetryTimer, sendSubscribe, sendUnsubscribe, wsEnabled],
  );

  useEffect(() => {
    if (!versionLoggedRef.current) {
      versionLoggedRef.current = true;
      console.info("[SUPPORT FRONT VERSION]", SUPPORT_FRONT_FIX_VERSION);
    }
  }, []);

  useEffect(() => {
    if (!wsEnabled) {
      return;
    }
    ensureSubscribed(selectedTicketId, status === "connected" ? "ws_connected" : "ws_pending");
  }, [ensureSubscribed, selectedTicketId, status, wsEnabled]);

  useEffect(
    () => () => {
      clearSubscribeRetryTimer();
      clearTypingIdleTimer();
      clearTypingHideTimer();
    },
    [clearSubscribeRetryTimer, clearTypingHideTimer, clearTypingIdleTimer],
  );

  const emitTyping = useCallback(
    (active: boolean) => {
      if (!selectedTicketId) {
        return;
      }
      send({
        type: active ? "support_typing" : "support_typing_stop",
        ticket_id: selectedTicketId,
        author_role: "usuario",
        author_label: authorLabel,
      });
    },
    [authorLabel, selectedTicketId, send],
  );

  const stopTyping = useCallback(() => {
    clearTypingIdleTimer();
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      emitTyping(false);
    }
  }, [clearTypingIdleTimer, emitTyping]);

  const handleInputActivity = useCallback(() => {
    if (!selectedTicketId || !wsEnabled) {
      return;
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      emitTyping(true);
    }
    clearTypingIdleTimer();
    typingIdleTimerRef.current = window.setTimeout(() => stopTyping(), TYPING_IDLE_MS);
  }, [clearTypingIdleTimer, emitTyping, selectedTicketId, stopTyping, wsEnabled]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  useEffect(() => {
    (window as unknown as { __SAGRA_USER_SUPPORT_WS__?: object }).__SAGRA_USER_SUPPORT_WS__ = {
      version: SUPPORT_FRONT_FIX_VERSION,
      status: wsStatusRef.current,
      subscribedTicket: subscribedTicketRef.current,
      selectedTicket: selectedTicketRef.current,
      path: wsPath,
    };
  });

  return {
    remoteTyping,
    handleInputActivity,
    stopTyping,
    wsStatus: status as WebSocketStatus,
  };
}
