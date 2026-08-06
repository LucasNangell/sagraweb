/** Toast nativo do SO (Action Center / bandeja) via Service Worker ou Notification API. */

function assetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const root = base.endsWith("/") ? base : `${base}/`;
  return new URL(relativePath, `${window.location.origin}${root}`).href;
}

export interface NativeNotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  nro?: number | null;
  ano?: number | null;
}

export async function showNativeNotification(
  payload: NativeNotificationPayload,
): Promise<boolean> {
  if (!("Notification" in window)) {
    return false;
  }
  if (Notification.permission !== "granted") {
    return false;
  }

  const tag =
    payload.tag ||
    (payload.nro != null && payload.ano != null
      ? `sagra-os-${payload.nro}-${payload.ano}`
      : "sagra-os");
  const url =
    payload.url ||
    (payload.nro != null && payload.ano != null
      ? `${window.location.origin}/gerencia?ano=${payload.ano}&id=${payload.nro}`
      : window.location.href);

  const options: NotificationOptions = {
    body: payload.body,
    icon: assetUrl("icons/icon-192.png"),
    badge: assetUrl("icons/favicon-32.png"),
    tag,
    renotify: true,
    data: { url, nro: payload.nro ?? null, ano: payload.ano ?? null },
    lang: "pt-BR",
  };

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration.showNotification) {
        await registration.showNotification(payload.title, options);
        return true;
      }
    }
  } catch (error) {
    console.warn("showNotification via SW falhou:", error);
  }

  try {
    const notification = new Notification(payload.title, options);
    notification.onclick = () => {
      window.focus();
      window.location.assign(url);
      notification.close();
    };
    return true;
  } catch (error) {
    console.warn("Notification API falhou:", error);
    return false;
  }
}
