/**
 * Chat de suporte no WebSocket compartilhado da aba (mesmo `/ws?ponto=` da home).
 */
import { sagraWebSocketHub, type SharedWsStatus } from "@/lib/sagraWebSocketHub";
import { supportWsLog, supportWsLogSend } from "@/lib/supportWsDebug";

export type SupportHubStatus = SharedWsStatus;

type MessageListener = (data: unknown) => void;
type StatusListener = (status: SupportHubStatus) => void;

class SupportWebSocketHub {
  private path = "";
  private ponto: string | null = null;
  private refCount = 0;
  private listeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private subscribedTickets = new Set<number>();
  private status: SupportHubStatus = "disconnected";
  private offMessage: (() => void) | null = null;
  private offStatus: (() => void) | null = null;

  acquire(ponto: string | null): void {
    if (!ponto) {
      return;
    }
    this.refCount += 1;
    const path = `/ws?ponto=${encodeURIComponent(ponto)}`;
    const pathChanged = this.path !== path;
    if (pathChanged && this.path) {
      this.detachSocket();
    }
    this.path = path;
    this.ponto = ponto;
    this.attachSocket();
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.detachSocket();
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
    if (!this.path) {
      return false;
    }
    return sagraWebSocketHub.send(this.path, data);
  }

  subscribe(ticketId: number, reason = "hub"): boolean {
    this.subscribedTickets.add(ticketId);
    const payload = { type: "support_subscribe", ticket_id: ticketId };
    const sent = this.send(payload);
    supportWsLogSend("SUPPORT HUB SUBSCRIBE", payload, sent);
    supportWsLog("SUPPORT HUB SUBSCRIBE", `${reason} ticket=${ticketId}`, {
      sent,
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

  private resubscribeAll(): void {
    for (const ticketId of this.subscribedTickets) {
      this.send({ type: "support_subscribe", ticket_id: ticketId });
    }
  }

  private attachSocket(): void {
    if (!this.path) {
      return;
    }
    if (this.offMessage && this.offStatus) {
      return;
    }
    sagraWebSocketHub.acquire(this.path);
    this.offMessage = sagraWebSocketHub.addMessageListener(this.path, (parsed) => {
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
    });
    this.offStatus = sagraWebSocketHub.addStatusListener(this.path, (next) => {
      const prev = this.status;
      this.setStatus(next);
      if (next === "connected" && prev !== "connected") {
        supportWsLog("SUPPORT HUB OPEN", this.path, { ponto: this.ponto });
        this.resubscribeAll();
      }
      if (next === "disconnected") {
        supportWsLog("SUPPORT HUB CLOSE", this.path);
      }
    });
  }

  private detachSocket(): void {
    this.offMessage?.();
    this.offStatus?.();
    this.offMessage = null;
    this.offStatus = null;
    if (this.path) {
      sagraWebSocketHub.release(this.path);
    }
    this.setStatus("disconnected");
  }
}

export const supportWebSocketHub = new SupportWebSocketHub();

if (import.meta.env.DEV) {
  (window as unknown as { __SAGRA_SUPPORT_HUB__?: typeof supportWebSocketHub }).__SAGRA_SUPPORT_HUB__ =
    supportWebSocketHub;
}
