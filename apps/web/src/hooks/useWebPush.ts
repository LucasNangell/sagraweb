import { useCallback } from "react";

import {
  fetchVapidPublicKey,
  registerPushSubscription,
} from "@/api/osNotificacao";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output as Uint8Array<ArrayBuffer>;
}

function appScope(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** URL absoluta de asset estático (SW precisa de origem, não path relativo). */
function staticAssetUrl(filename: string): string {
  const scope = appScope();
  return new URL(filename, `${window.location.origin}${scope}`).href;
}

function workboxSwUrl(): string {
  return staticAssetUrl("sw.js");
}

function standalonePushSwUrl(): string {
  return staticAssetUrl("push-sw.js");
}

function useWorkboxServiceWorker(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_PWA_DEV === "true";
}

function scriptHandlesPush(scriptUrl: string, workbox: boolean): boolean {
  const url = scriptUrl.toLowerCase();
  if (url.includes("push-sw.js")) {
    return true;
  }
  return workbox && url.includes("sw.js");
}

/**
 * Garante SW com handler de push (push-sw.js ou Workbox + importScripts).
 * Em DEV sem PWA: registra push-sw.js isolado (necessário para push com aba fechada).
 */
async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker não suportado neste navegador.");
  }

  const scope = appScope();
  const workbox = useWorkboxServiceWorker();
  const targetUrl = workbox ? workboxSwUrl() : standalonePushSwUrl();

  let registration = await navigator.serviceWorker.getRegistration(scope);
  const activeUrl = registration?.active?.scriptURL ?? "";
  const waitingUrl = registration?.waiting?.scriptURL ?? "";
  const hasPushHandler =
    scriptHandlesPush(activeUrl, workbox) || scriptHandlesPush(waitingUrl, workbox);

  if (!registration || !hasPushHandler) {
    if (registration && !workbox) {
      await registration.unregister();
    }
    registration = await navigator.serviceWorker.register(targetUrl, {
      scope,
      updateViaCache: "none",
    });
  }

  // Não ativar SW em waiting aqui — a ativação fica no boot do PWA (F5 / reabrir).
  if (registration.installing) {
    await new Promise<void>((resolve) => {
      const sw = registration!.installing!;
      const onState = () => {
        if (sw.state === "activated" || sw.state === "redundant") {
          sw.removeEventListener("statechange", onState);
          resolve();
        }
      };
      sw.addEventListener("statechange", onState);
    });
  }

  await navigator.serviceWorker.ready;

  const active = await navigator.serviceWorker.getRegistration(scope);
  if (!active?.pushManager) {
    throw new Error("Service Worker push indisponível.");
  }
  return active;
}

export function useWebPush() {
  const requestBrowserPush = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) {
      window.alert("Este navegador não suporta notificações.");
      return false;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      window.alert(
        "Permissão negada. No Windows, abra Configurações → Sistema → Notificações e permita o navegador (Edge/Chrome) exibir alertas.",
      );
      return false;
    }

    if (!("PushManager" in window)) {
      window.alert("Push notifications não suportadas neste navegador.");
      return false;
    }

    try {
      const registration = await ensurePushServiceWorker();

      const publicKey = await fetchVapidPublicKey();
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Subscription push inválida.");
      }

      await registerPushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        user_agent: navigator.userAgent,
      });
      return true;
    } catch (error) {
      console.error("Falha ao registrar push:", error);
      window.alert(
        `Não foi possível ativar notificações push: ${
          error instanceof Error ? error.message : "erro desconhecido"
        }`,
      );
      return false;
    }
  }, []);

  return { requestBrowserPush };
}
