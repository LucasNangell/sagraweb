import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimNativeNotification,
  getNotificationSupport,
  markNativeNotificationShown,
  pruneNativeNotificationDedupe,
  showNativeNotification,
  spaAbsoluteUrl,
  wasNativeNotificationShown,
} from "./nativeNotification";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static instances: FakeNotification[] = [];
  onclick: ((this: Notification, ev: Event) => void) | null = null;
  close = vi.fn();

  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

function stubServiceWorker(container: Partial<ServiceWorkerContainer> | undefined) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
}

describe("nativeNotification", () => {
  beforeEach(() => {
    localStorage.clear();
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    stubServiceWorker({
      getRegistration: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("getNotificationSupport distingue permissão, suporte e contexto inseguro", () => {
    expect(getNotificationSupport()).toBe("granted");

    FakeNotification.permission = "denied";
    expect(getNotificationSupport()).toBe("denied");

    FakeNotification.permission = "default";
    expect(getNotificationSupport()).toBe("default");

    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    expect(getNotificationSupport()).toBe("insecure-context");

    vi.stubGlobal("Notification", undefined);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    expect(getNotificationSupport()).toBe("unsupported");
  });

  it("deduplica pelo notification_id entre chamadas", async () => {
    expect(await claimNativeNotification(42)).toBe(true);
    expect(wasNativeNotificationShown(42)).toBe(true);
    expect(await claimNativeNotification(42)).toBe(false);
    expect(await claimNativeNotification(0)).toBe(true);
  });

  it("prune remove chaves expiradas", () => {
    markNativeNotificationShown(7);
    localStorage.setItem(
      "sagra-native-notified:8",
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    pruneNativeNotificationDedupe();
    expect(wasNativeNotificationShown(7)).toBe(true);
    expect(localStorage.getItem("sagra-native-notified:8")).toBeNull();
  });

  it("usa Notification API quando não há service worker (fallback)", async () => {
    const shown = await showNativeNotification({
      title: "OS 100/2026",
      body: "Andamento",
      nro: 100,
      ano: 2026,
      notificationId: 55,
    });
    expect(shown).toBe(true);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0]?.title).toBe("OS 100/2026");
    expect(FakeNotification.instances[0]?.options?.tag).toBe("sagra-notif-55");
    expect(FakeNotification.instances[0]?.options?.renotify).toBe(true);
  });

  it("não mostra de novo o mesmo notificationId", async () => {
    await showNativeNotification({
      title: "OS 1/2026",
      body: "a",
      notificationId: 9,
    });
    const second = await showNativeNotification({
      title: "OS 1/2026",
      body: "a",
      notificationId: 9,
    });
    expect(second).toBe(false);
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("cai no fallback se getRegistration nunca resolver", async () => {
    stubServiceWorker({
      getRegistration: () => new Promise(() => undefined),
    });

    const shown = await showNativeNotification({
      title: "Teste",
      body: "sem SW",
    });
    expect(shown).toBe(true);
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("monta URL da gerência com BASE_URL", () => {
    const url = spaAbsoluteUrl("gerencia", "ano=2026&id=100");
    expect(url).toContain("/gerencia?ano=2026&id=100");
  });
});
