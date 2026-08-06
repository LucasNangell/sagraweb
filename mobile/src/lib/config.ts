/** Base URL do servidor SAGRA (produção pública). */
export const DEFAULT_SERVER_ORIGIN = "https://cgrafsysvm.camara.leg.br";

/** Prefixo da API atrás do Nginx. */
export const API_PREFIX = "/sagra/api";

/**
 * Em desenvolvimento (Vite), usa o proxy relativo `/sagra/api`.
 * No Capacitor / build, aponta para o host de produção.
 */
export function getServerOrigin(): string {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "";
    }
  }
  return DEFAULT_SERVER_ORIGIN;
}

export function apiUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${getServerOrigin()}${API_PREFIX}${clean}`;
}

export function wsUrl(): string {
  const origin = getServerOrigin() || window.location.origin;
  const url = new URL(origin || "https://cgrafsysvm.camara.leg.br");
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}${API_PREFIX}/ws/`;
}
