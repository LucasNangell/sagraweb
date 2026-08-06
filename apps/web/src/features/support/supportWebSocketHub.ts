/**
 * Conexão WebSocket única por aba para chat de suporte.
 * Evita múltiplos sockets competindo por subscribe/delivery.
 */
import { resolveWebSocketUrl } from "@/lib/websocket";
import { supportWsLog, supportWsLogSend } from "@/lib/supportWsDebug";

export type SupportHubStatus = "connecting" | "connected" | "disconnected" | "error";

type MessageListener = (data: unknown) => void;
type StatusListener = (status: SupportHubStatus) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 25_000;

class SupportWebSocketHub {
  private ws: WebSocket | null = null;
  private path = "";
  private ponto: string | null = null;
  private refCount = 0;
  private listeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private subscribedTickets = new Set<number>();
  private status: SupportHubStatus = "disconnected";
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;

  acquire(ponto: string | null): void {
    if (!ponto) {
      return;
    }
    this.refCount += 1;
    const path = `/ws?ponto=${encodeURIComponent(ponto)}`;
    const pathChanged = this.path !== path;
    this.path = path;
    this.ponto = ponto;
    if (pathChanged) {
      this.closeSocket();
    }
    if (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      this.openSocket();
    }
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.closeSocket();
      this.path = "";
      this.ponto = null;
    }
  }

  addListener(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): SupportHubStatus {
    return this.status;
  }

  send(data: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  subscribe(ticketId: number, reason = "hub"): boolean {
    this.subscribedTickets.add(ticketId);
    const payload = { type: "support_subscribe", ticket_id: ticketId };
    const sent = this.send(payload);
    supportWsLogSend("SUPPORT HUB SUBSCRIBE", payload, sent);
    supportWsLog("SUPPORT HUB SUBSCRIBE", `${reason} ticket=${ticketId}`, {
      sent,
      wsState: this.ws?.readyState,
      queued: !sent,
    });
    return true;
  }

  unsubscribe(ticketId: number, reason = "hub"): void {
    if (!this.subscribedTickets.has(ticketId)) {
      return;
    }
    const payload = { type: "support_unsubscribe", ticket_id: ticketId };
    supportWsLogSend("SUPPORT HUB UNSUBSCRIBE", payload, this.send(payload));
    this.subscribedTickets.delete(ticketId);
    supportWsLog("SUPPORT HUB UNSUBSCRIBE", `${reason} ticket=${ticketId}`);
  }

  isSubscribed(ticketId: number): boolean {
    return this.subscribedTickets.has(ticketId);
  }

  private setStatus(next: SupportHubStatus): void {
    this.status = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.refCount === 0 || !this.path) {
      return;
    }
    this.clearReconnectTimer();
    const next = this.reconnectAttempt + 1;
    this.reconnectAttempt = next;
    let delay = Math.min(RECONNECT_BASE_MS * 2 ** (next - 1), RECONNECT_MAX_MS);
    if (document.hidden) {
      delay = Math.max(delay, RECONNECT_MAX_MS);
    }
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }

  private resubscribeAll(): void {
    for (const ticketId of this.subscribedTickets) {
      this.send({ type: "support_subscribe", ticket_id: ticketId });
    }
  }

  private openSocket(): void {
    if (this.refCount === 0 || !this.path) {
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveWebSocketUrl(this.path));
    } catch (err) {
      this.setStatus("error");
      supportWsLog("SUPPORT HUB ERROR", "open failed", err);
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.clearHeartbeat();
      this.heartbeatTimer = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }, HEARTBEAT_MS);
      supportWsLog("SUPPORT HUB OPEN", this.path, { ponto: this.ponto });
      this.resubscribeAll();
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (
        import.meta.env.DEV &&
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        String((parsed as { type?: string }).type).startsWith("support_")
      ) {
        console.info("[SUPPORT HUB RX]", parsed);
      }
      for (const listener of this.listeners) {
        listener(parsed);
      }
    };

    ws.onerror = () => {
      this.setStatus("error");
      supportWsLog("SUPPORT HUB ERROR", this.path);
    };

    ws.onclose = () => {
      this.clearHeartbeat();
      this.ws = null;
      this.setStatus("disconnected");
      supportWsLog("SUPPORT HUB CLOSE", this.path);
      this.scheduleReconnect();
    };
  }

  private closeSocket(): void {
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.reconnectAttempt = 0;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}

export const supportWebSocketHub = new SupportWebSocketHub();

if (import.meta.env.DEV) {
  (window as unknown as { __SAGRA_SUPPORT_HUB__?: typeof supportWebSocketHub }).__SAGRA_SUPPORT_HUB__ =
    supportWebSocketHub;
}
