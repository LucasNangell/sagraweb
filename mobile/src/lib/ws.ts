import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "./config";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseSagraWebSocketOptions {
  enabled?: boolean;
  onMessage?: (data: unknown) => void;
}

export function useSagraWebSocket({
  enabled = true,
  onMessage,
}: UseSagraWebSocketOptions = {}) {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const disconnect = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;
    disconnect();
    setStatus("connecting");
    try {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus("connected");
        const ping = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
          }
        }, 25_000);
        ws.addEventListener("close", () => window.clearInterval(ping));
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as unknown;
          onMessageRef.current?.(data);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        /* onclose handles reconnect */
      };

      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        if (!enabled) return;
        const delay = Math.min(30_000, 2_000 * 2 ** retryRef.current);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };
    } catch {
      setStatus("disconnected");
    }
  }, [disconnect, enabled]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    connect();
    return () => disconnect();
  }, [connect, disconnect, enabled]);

  return { status, reconnect: connect };
}
