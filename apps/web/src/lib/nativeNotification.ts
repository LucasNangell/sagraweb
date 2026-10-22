/** Toast nativo do SO (Action Center / bandeja) via Service Worker ou Notification API. */

const DEDUPE_PREFIX = "sagra-native-notified:";
const DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUPE_LOCK = "sagra-native-notification";
const SW_LOOKUP_TIMEOUT_MS = 800;

export const OPEN_NOTIFICATION_CENTER_HASH = "notificacoes";
export const OPEN_NOTIFICATION_CENTER_EVENT = "sagra:open-notifications";

export type NotificationSupport =
  | "unsupported"
  | "insecure-context"
  | "denied"
  | "default"
  | "granted";

export function appScope(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function spaAbsoluteUrl(
  pathname = "",
  search = "",
  hash = "",
): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
  const url = new URL(pathname.replace(/^\//, ""), `${origin}${appScope()}`);
  if (search) {
    url.search = search.startsWith("?") ? search : `?${search}`;
  }
  if (hash) {
    url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  }
  return url.href;
}

function assetUrl(relativePath: string): string {
  return spaAbsoluteUrl(relativePath);
}

export function getNotificationSupport(): NotificationSupport {
  const secure =
    typeof window === "undefined" || window.isSecureContext !== false;
  const NotificationApi = window.Notification;
  if (typeof NotificationApi === "undefined") {
    return secure ? "unsupported" : "insecure-context";
  }
  if (!secure) {
    return "insecure-context";
  }
  const permission = NotificationApi.permission;
  if (permission === "granted" || permission === "denied" || permission === "default") {
    return permission;
  }
  return "unsupported";
}

function dedupeKey(notificationId: number): string {
  return `${DEDUPE_PREFIX}${notificationId}`;
}

export function pruneNativeNotificationDedupe(now = Date.now()): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(DEDUPE_PREFIX)) {
        continue;
      }
      const ts = Number(localStorage.getItem(key));
      if (!Number.isFinite(ts) || now - ts > DEDUPE_TTL_MS) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function wasNativeNotificationShown(notificationId: number): boolean {
  if (!notificationId || notificationId <= 0) {
    return false;
  }
  try {
    const raw = localStorage.getItem(dedupeKey(notificationId));
    const ts = Number(raw);
    if (!Number.isFinite(ts)) {
      return false;
    }
    if (Date.now() - ts > DEDUPE_TTL_MS) {
      localStorage.removeItem(dedupeKey(notificationId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markNativeNotificationShown(notificationId: number): void {
  if (!notificationId || notificationId <= 0) {
    return;
  }
  try {
    localStorage.setItem(dedupeKey(notificationId), String(Date.now()));
  } catch {
    /* ignore */
  }
}

async function withDedupeLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (!locks?.request) {
    return await fn();
  }
  return await locks.request(DEDUPE_LOCK, () => fn());
}

/** Reserva o id para esta aba. false = outra aba/esta sessão já exibiu. */
export async function claimNativeNotification(
  notificationId: number | null | undefined,
): Promise<boolean> {
  if (notificationId == null || notificationId <= 0) {
    return true;
  }
  return withDedupeLock(() => {
    pruneNativeNotificationDedupe();
    if (wasNativeNotificationShown(notificationId)) {
      return false;
    }
    markNativeNotificationShown(notificationId);
    return true;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker?.getRegistration) {
    return null;
  }
  const registration = await withTimeout(
    navigator.serviceWorker.getRegistration(appScope()),
    SW_LOOKUP_TIMEOUT_MS,
  );
  if (registration?.showNotification) {
    return registration;
  }
  return null;
}

export interface NativeNotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  nro?: number | null;
  ano?: number | null;
  notificationId?: number | null;
  urgent?: boolean;
  openNotificationCenter?: boolean;
}

function resolveNotificationUrl(payload: NativeNotificationPayload): string {
  if (payload.url) {
    return payload.url;
  }
  if (payload.openNotificationCenter) {
    return spaAbsoluteUrl("", "", OPEN_NOTIFICATION_CENTER_HASH);
  }
  const nro = payload.nro;
  const ano = payload.ano;
  if (nro != null && nro > 0 && ano != null && ano > 0) {
    return spaAbsoluteUrl("gerencia", `ano=${ano}&id=${nro}`);
  }
  return spaAbsoluteUrl();
}

function openNotificationTarget(url: string, openCenter: boolean): void {
  window.focus();
  if (openCenter) {
    window.dispatchEvent(new Event(OPEN_NOTIFICATION_CENTER_EVENT));
    const hash = `#${OPEN_NOTIFICATION_CENTER_HASH}`;
    if (window.location.hash !== hash) {
      window.location.hash = OPEN_NOTIFICATION_CENTER_HASH;
    }
    return;
  }
  window.location.assign(url);
}

export async function showNativeNotification(
  payload: NativeNotificationPayload,
): Promise<boolean> {
  if (getNotificationSupport() !== "granted") {
    return false;
  }

  const claimed = await claimNativeNotification(payload.notificationId ?? null);
  if (!claimed) {
    return false;
  }

  const tag =
    payload.tag ||
    (payload.notificationId
      ? `sagra-notif-${payload.notificationId}`
      : payload.nro != null && payload.ano != null
        ? `sagra-os-${payload.nro}-${payload.ano}`
        : "sagra-os");
  const url = resolveNotificationUrl(payload);
  const isNew = Boolean(payload.notificationId) || !payload.tag;

  const options: NotificationOptions = {
    body: payload.body,
    icon: assetUrl("icons/icon-192.png"),
    badge: assetUrl("icons/favicon-32.png"),
    tag,
    renotify: isNew,
    requireInteraction: Boolean(payload.urgent),
    data: {
      url,
      nro: payload.nro ?? null,
      ano: payload.ano ?? null,
      notificationId: payload.notificationId ?? null,
      openNotificationCenter: Boolean(payload.openNotificationCenter),
    },
    lang: "pt-BR",
  };

  try {
    const registration = await getPushRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(payload.title, options);
      return true;
    }
  } catch (error) {
    console.warn("showNotification via SW falhou:", error);
  }

  try {
    const notification = new Notification(payload.title, options);
    notification.onclick = () => {
      openNotificationTarget(url, Boolean(payload.openNotificationCenter));
      notification.close();
    };
    return true;
  } catch (error) {
    console.warn("Notification API falhou:", error);
    return false;
  }
}
