/**
 * Cliente HTTP — dev: /api (proxy Vite). Producao Nginx: /sagra/api.
 */
function isLocalUvicornWithoutNginx(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const { hostname, port } = window.location;
  const localHost = hostname === "localhost" || hostname === "127.0.0.1";
  return localHost && (port === "8001" || port === "");
}

function isPublicProductionHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "cgrafsysvm.camara.leg.br" ||
    host === "cgraf.online" ||
    host === "www.cgraf.online" ||
    host.endsWith(".workers.dev") ||
    host.endsWith(".cgraf.online")
  ) {
    return true;
  }
  return false;
}

export function resolveSagraApiPrefix(): string {
  if (typeof window !== "undefined") {
    if (isLocalUvicornWithoutNginx()) {
      return "/api";
    }
    // PWA mobile / domínio público — API sempre em /sagra/api (OBS usa /api).
    if (isPublicProductionHost(window.location.hostname)) {
      return "/sagra/api";
    }
  }

  const explicit = import.meta.env.VITE_API_PREFIX?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const base = import.meta.env.BASE_URL;
  if (base && base !== "/") {
    return `${base.replace(/\/$/, "")}/api`;
  }
  // Build sem VITE_API_PREFIX ainda deve usar /sagra/api (OBS ocupa /api na raiz).
  if (import.meta.env.PROD) {
    return "/sagra/api";
  }
  return "/api";
}

export function apiUrl(path: string): string {
  const apiPrefix = resolveSagraApiPrefix();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith(apiPrefix)) {
    return normalized;
  }
  return `${apiPrefix}${normalized}`;
}

/** Arquivo estático na raiz do app (ex.: config_painel_global.json em /sagra/). */
export function appStaticUrl(path: string): string {
  const file = path.startsWith("/") ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL;
  if (base && base !== "/") {
    return `${base.replace(/\/$/, "")}/${file}`;
  }
  return `/${file}`;
}

function isHtmlApiResponse(text: string): boolean {
  const head = text.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = apiUrl(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as {
        detail?: string | { message?: string; renderStatus?: string };
        message?: string;
      };
      if (typeof data.detail === "string" && data.detail.trim()) {
        if (res.status === 404 && data.detail === "Not Found") {
          throw new Error(
            "Rota da API não encontrada. Reinicie o backend (porta 8001) após atualizar o código.",
          );
        }
        throw new Error(data.detail);
      }
      if (
        data.detail &&
        typeof data.detail === "object" &&
        typeof data.detail.message === "string" &&
        data.detail.message.trim()
      ) {
        throw new Error(data.detail.message);
      }
      if (typeof data.message === "string" && data.message.trim()) {
        throw new Error(data.message);
      }
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
        if (res.status === 502) {
          throw new Error(
            "Servidor indisponível (502). Confira se o túnel zrok (sagra-painel) está ativo e se a API foi reiniciada.",
          );
        }
        if (isHtmlApiResponse(text)) {
          throw new Error(
            res.status === 403
              ? "Acesso bloqueado pelo proxy/WAF (403). O método HTTP pode ter sido bloqueado na borda; tente de novo ou use a rede interna."
              : `Resposta HTML inesperada da API (${res.status}). Verifique se a URL da API está correta.`,
          );
        }
        throw new Error(`Resposta inválida da API (${res.status}): ${snippet}`);
      }
      if (parseErr instanceof Error && !parseErr.message.startsWith("API ")) {
        throw parseErr;
      }
    }
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(
      res.status >= 500
        ? `Erro no servidor (${res.status}). Reinicie a API e confira config/.env (SAGRA_SESSION_SECRET). ${snippet}`
        : `API ${res.status}: ${snippet}`,
    );
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Resposta inválida da API (${path}).`);
  }
}
