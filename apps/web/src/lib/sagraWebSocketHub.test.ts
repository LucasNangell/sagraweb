import { afterEach, describe, expect, it, vi } from "vitest";

import { sagraWebSocketHub } from "./sagraWebSocketHub";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
    this.readyState = 0;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("sagraWebSocketHub", () => {
  afterEach(() => {
    sagraWebSocketHub._resetForTests();
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("compartilha um socket por path entre acquires", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    sagraWebSocketHub.acquire("/ws?ponto=1");
    sagraWebSocketHub.acquire("/ws?ponto=1");
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeWebSocket.instances.length).toBe(1);
    sagraWebSocketHub.release("/ws?ponto=1");
    expect(FakeWebSocket.instances[0]?.readyState).toBe(1);
    sagraWebSocketHub.release("/ws?ponto=1");
  });
});
