import { resolveSagraApiPrefix } from "@/lib/api";

/**
 * URL do WebSocket SAGRA.
 * Dev (Vite): `/ws` via proxy dedicado. Produção Nginx: `/sagra/api/ws/`.
 */
export function resolveWebSocketUrl(path: string): string {
  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;

  const raw = path.startsWith("/") ? path : `/${path}`;
  const qIdx = raw.indexOf("?");
  const query = qIdx >= 0 ? raw.slice(qIdx) : "";

  const apiPrefix = resolveSagraApiPrefix();
  // Dev + Vite: proxy dedicado `/ws` (estável). Prod/Nginx: `/sagra/api/ws/` (barra final).
  if (import.meta.env.DEV && apiPrefix === "/api") {
    return `${protocol}//${host}/ws${query}`;
  }
  return `${protocol}//${host}${apiPrefix}/ws/${query}`;
}
