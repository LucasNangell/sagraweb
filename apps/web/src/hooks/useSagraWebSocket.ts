import { useCallback, useEffect, useRef, useState } from "react";

import { resolveWebSocketUrl } from "@/lib/websocket";

export type WebSocketStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

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

export function useSagraWebSocket<T = unknown>({
  path,
  enabled = true,
  reconnectBaseMs = 1000,
  reconnectMaxMs = 30_000,
  heartbeatMs = 25_000,
  onMessage,
  onOpen,
  onClose,
  parseMessage = defaultParse,
}: UseSagraWebSocketOptions<T>) {
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const clearHeartbeat = () => {
    if (heartbeatRef.current != null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const scheduleReconnectRef = useRef<() => void>(() => {});

  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    if (!enabled) {
      return;
    }
    clearTimer();

    if (wsRef.current) {
      const prev = wsRef.current;
      wsRef.current = null;
      prev.onclose = null;
      prev.onerror = null;
      if (
        prev.readyState === WebSocket.CONNECTING ||
        prev.readyState === WebSocket.OPEN
      ) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
      }
    }

    setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveWebSocketUrl(path));
    } catch (err) {
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Falha ao abrir WebSocket");
      scheduleReconnectRef.current();
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setReconnectAttempt(0);
      setStatus("connected");
      setLastError(null);
      clearHeartbeat();
      heartbeatRef.current = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[ws] heartbeat falhou:", err);
          }
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }, heartbeatMs);
      if (import.meta.env.DEV) {
        console.info("[ws] conectado:", resolveWebSocketUrl(path));
      }
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      const parsed = parseMessage(String(event.data));
      if (parsed == null) {
        return;
      }
      setLastMessage(parsed);
      onMessageRef.current?.(parsed);
    };

    ws.onerror = () => {
      setStatus("error");
      setLastError("Erro na conexão WebSocket");
      if (import.meta.env.DEV) {
        console.warn("[ws] erro:", resolveWebSocketUrl(path));
      }
    };

    ws.onclose = () => {
      clearHeartbeat();
      wsRef.current = null;
      setStatus("disconnected");
      onCloseRef.current?.();
      scheduleReconnectRef.current();
    };
  };

  scheduleReconnectRef.current = () => {
    clearTimer();
    const next = attemptRef.current + 1;
    attemptRef.current = next;
    setReconnectAttempt(next);
    let delay = Math.min(reconnectBaseMs * 2 ** (next - 1), reconnectMaxMs);
    if (document.hidden) {
      delay = Math.max(delay, reconnectMaxMs);
    }
    timerRef.current = window.setTimeout(() => connectRef.current(), delay);
  };

  const disconnect = useCallback(() => {
    clearTimer();
    clearHeartbeat();
    attemptRef.current = 0;
    setReconnectAttempt(0);
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onclose = null;
      ws.onerror = null;
      if (
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN
      ) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }
    setStatus("disconnected");
  }, []);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    setReconnectAttempt(0);
    connectRef.current();
  }, []);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    // Evita rajada de conexões WS quando Vite monta vários hooks ao mesmo tempo (StrictMode).
    const jitterMs = Math.floor(Math.random() * 400);
    const timer = window.setTimeout(() => connectRef.current(), jitterMs);
    return () => {
      window.clearTimeout(timer);
      disconnect();
    };
  }, [disconnect, enabled, path]);

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
