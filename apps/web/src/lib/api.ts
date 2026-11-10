import {
  isSessionProblemCode,
  NETWORK_ERROR_CODE,
  reportSessionProblem,
} from "@/lib/sessionEvents";

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

export type ApiErrorDetail = {
  message?: string;
  code?: string;
  maquinas?: string[];
  renderStatus?: string;
};

export type ApiRequestError = Error & {
  status?: number;
  apiDetail?: ApiErrorDetail;
};

export function createApiError(
  message: string,
  status: number,
  detail?: ApiErrorDetail,
): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  error.status = status;
  if (detail) error.apiDetail = detail;
  return error;
}

export function getApiErrorDetail(error: unknown): ApiErrorDetail | null {
  if (!error || typeof error !== "object") return null;
  if (!("apiDetail" in error)) return null;
  const detail = (error as ApiRequestError).apiDetail;
  return detail && typeof detail === "object" ? detail : null;
}

const NETWORK_ERROR_MESSAGE =
  "Não foi possível conectar ao servidor do SAGRA. Verifique sua conexão de rede — " +
  "o sistema tentará novamente automaticamente.";

const SESSION_ERROR_MESSAGE =
  "Sua sessão expirou. Reconectando automaticamente — se necessário, " +
  "será solicitado um novo login sem perder a tela atual.";

function serverErrorMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return `O servidor do SAGRA está temporariamente indisponível (${status}). Tente novamente em instantes.`;
  }
  return `O servidor encontrou um erro ao processar a solicitação (${status}). Tente novamente; se o problema persistir, contate o suporte.`;
}

/** Erro amigável a partir de uma resposta HTTP não-OK. */
function buildHttpError(status: number, text: string): ApiRequestError {
  let data: {
    detail?: string | ApiErrorDetail;
    message?: string;
    code?: string;
  } | null = null;
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    data = null;
  }

  if (data && typeof data === "object") {
    const code = typeof data.code === "string" ? data.code : undefined;
    if (isSessionProblemCode(code)) {
      reportSessionProblem(code);
      const detailText = typeof data.detail === "string" ? data.detail : undefined;
      return createApiError(SESSION_ERROR_MESSAGE, status, {
        code,
        message: detailText,
      });
    }
    if (typeof data.detail === "string" && data.detail.trim()) {
      if (status === 404 && data.detail === "Not Found") {
        return createApiError(
          "Rota da API não encontrada. Reinicie o backend (porta 8001) após atualizar o código.",
          status,
        );
      }
      return createApiError(data.detail, status, code ? { code } : undefined);
    }
    if (
      data.detail &&
      typeof data.detail === "object" &&
      typeof data.detail.message === "string" &&
      data.detail.message.trim()
    ) {
      return createApiError(data.detail.message, status, data.detail);
    }
    if (typeof data.message === "string" && data.message.trim()) {
      return createApiError(data.message, status);
    }
  }

  if (data === null) {
    if (status === 502) {
      return createApiError(
        "Servidor indisponível (502). Confira se o túnel zrok (sagra-painel) está ativo e se a API foi reiniciada.",
        status,
      );
    }
    if (isHtmlApiResponse(text)) {
      return createApiError(
        status === 403
          ? "Acesso bloqueado pelo proxy/WAF (403). O método HTTP pode ter sido bloqueado na borda; tente de novo ou use a rede interna."
          : status >= 500
            ? serverErrorMessage(status)
            : `Resposta HTML inesperada da API (${status}). Verifique se a URL da API está correta.`,
        status,
      );
    }
  }

  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (status >= 500) {
    if (snippet) console.error(`[api] ${status}: ${snippet}`);
    return createApiError(serverErrorMessage(status), status);
  }
  return createApiError(
    data === null && snippet
      ? `Resposta inválida da API (${status}): ${snippet}`
      : `API ${status}: ${snippet}`,
    status,
  );
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw createApiError(NETWORK_ERROR_MESSAGE, 0, { code: NETWORK_ERROR_CODE });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw buildHttpError(res.status, text ?? "");
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
