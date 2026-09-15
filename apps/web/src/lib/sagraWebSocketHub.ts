/**
 * Um WebSocket por path e por aba (refcounted).
 * Vários hooks (home, notificações, papelaria, suporte) compartilham o mesmo socket.
 */
import { resolveWebSocketUrl } from "@/lib/websocket";

export type SharedWsStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type MessageListener = (data: unknown) => void;
type StatusListener = (status: SharedWsStatus) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 25_000;

class PathSocket {
  path: string;
  refCount = 0;
  status: SharedWsStatus = "disconnected";
  private ws: WebSocket | null = null;
  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;

  constructor(path: string) {
    this.path = path;
  }

  acquire(): void {
    this.refCount += 1;
    if (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      this.open();
    }
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.close(false);
    }
  }

  addMessageListener(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
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

  reconnect(): void {
    this.reconnectAttempt = 0;
    this.open();
  }

  private setStatus(next: SharedWsStatus): void {
    this.status = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private clearReconnect(): void {
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
    if (this.refCount === 0) {
      return;
    }
    this.clearReconnect();
    const next = this.reconnectAttempt + 1;
    this.reconnectAttempt = next;
    let delay = Math.min(RECONNECT_BASE_MS * 2 ** (next - 1), RECONNECT_MAX_MS);
    if (document.hidden) {
      delay = Math.max(delay, RECONNECT_MAX_MS);
    }
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private open(): void {
    if (this.refCount === 0) {
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.clearReconnect();
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
    } catch {
      this.setStatus("error");
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
      if (import.meta.env.DEV) {
        console.info("[ws] conectado:", resolveWebSocketUrl(this.path));
      }
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const listener of this.messageListeners) {
        listener(parsed);
      }
    };

    ws.onerror = () => {
      this.setStatus("error");
    };

    ws.onclose = () => {
      this.clearHeartbeat();
      this.ws = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  private close(reconnect: boolean): void {
    this.clearReconnect();
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
    if (reconnect) {
      this.scheduleReconnect();
    }
  }
}

const sockets = new Map<string, PathSocket>();

function getSocket(path: string): PathSocket {
  let sock = sockets.get(path);
  if (!sock) {
    sock = new PathSocket(path);
    sockets.set(path, sock);
  }
  return sock;
}

export const sagraWebSocketHub = {
  acquire(path: string): void {
    getSocket(path).acquire();
  },
  release(path: string): void {
    const sock = sockets.get(path);
    if (!sock) {
      return;
    }
    sock.release();
    if (sock.refCount === 0) {
      sockets.delete(path);
    }
  },
  addMessageListener(path: string, listener: MessageListener): () => void {
    return getSocket(path).addMessageListener(listener);
  },
  addStatusListener(path: string, listener: StatusListener): () => void {
    return getSocket(path).addStatusListener(listener);
  },
  getStatus(path: string): SharedWsStatus {
    return sockets.get(path)?.status ?? "disconnected";
  },
  send(path: string, data: unknown): boolean {
    return sockets.get(path)?.send(data) ?? false;
  },
  reconnect(path: string): void {
    getSocket(path).reconnect();
  },
  /** Testes: esvazia sockets da aba. */
  _resetForTests(): void {
    for (const path of [...sockets.keys()]) {
      const sock = sockets.get(path);
      if (sock) {
        sock.refCount = 0;
      }
      this.release(path);
    }
    sockets.clear();
  },
};
