import { useCallback, useEffect, useRef, useState } from "react";

import {
  sagraWebSocketHub,
  type SharedWsStatus,
} from "@/lib/sagraWebSocketHub";

export type WebSocketStatus = SharedWsStatus;

export interface UseSagraWebSocketOptions<T> {
  path: string;
  enabled?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  heartbeatMs?: number;
  onMessage?: (data: T) => void;
  onOpen?: () => void;
  onClose?: () => void;
  parseMessage?: (raw: string) => T | null;
}

const defaultParse = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

function parseUnknown<T>(
  raw: unknown,
  parseMessage: (raw: string) => T | null,
): T | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    return parseMessage(raw);
  }
  return raw as T;
}

export function useSagraWebSocket<T = unknown>({
  path,
  enabled = true,
  onMessage,
  onOpen,
  onClose,
  parseMessage = defaultParse,
}: UseSagraWebSocketOptions<T>) {
  const [status, setStatus] = useState<WebSocketStatus>(() =>
    enabled ? sagraWebSocketHub.getStatus(path) : "disconnected",
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const parseRef = useRef(parseMessage);
  parseRef.current = parseMessage;
  const prevStatusRef = useRef<WebSocketStatus>(status);

  const send = useCallback(
    (data: unknown) => sagraWebSocketHub.send(path, data),
    [path],
  );

  const disconnect = useCallback(() => {
    setStatus("disconnected");
  }, []);

  const reconnect = useCallback(() => {
    sagraWebSocketHub.reconnect(path);
  }, [path]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      return;
    }
    sagraWebSocketHub.acquire(path);
    const offMsg = sagraWebSocketHub.addMessageListener(path, (raw) => {
      const parsed = parseUnknown(raw, (text) => parseRef.current(text));
      if (parsed == null) {
        return;
      }
      setLastMessage(parsed);
      onMessageRef.current?.(parsed);
    });
    const offStatus = sagraWebSocketHub.addStatusListener(path, (next) => {
      const prev = prevStatusRef.current;
      prevStatusRef.current = next;
      setStatus(next);
      if (next === "connected" && prev !== "connected") {
        setLastError(null);
        setReconnectAttempt(0);
        onOpenRef.current?.();
      }
      if (next === "disconnected" && prev === "connected") {
        onCloseRef.current?.();
      }
      if (next === "error") {
        setLastError("Erro na conexão WebSocket");
      }
    });
    return () => {
      offMsg();
      offStatus();
      sagraWebSocketHub.release(path);
    };
  }, [enabled, path]);

  return {
    status,
    lastError,
    lastMessage,
    reconnectAttempt,
    reconnect,
    disconnect,
    send,
  };
}
