/**
 * Cloudflare Worker: painel.cgraf.online -> SAGRA painel (via zrok)
 *
 * Comportamento:
 *   https://painel.cgraf.online/          -> painel setor (/sagra/painel/setor)
 *   https://painel.cgraf.online/setor     -> idem
 *   https://painel.cgraf.online/global    -> painel global
 *   https://painel.cgraf.online/* -> repassa ao zrok (assets, API em /sagra/api, etc.)
 *
 * Alternativa sem worker: Redirect Rule no Cloudflare (ver comentario REDIRECT_ONLY abaixo).
 *
 * Deploy:
 *   1. DNS: painel  CNAME  cgraf.online  (proxy laranja ativo)
 *   2. Workers > white-sun-19a3 (ou novo worker) > colar este codigo
 *   3. Triggers > Add route:  painel.cgraf.online/*
 *
 * REDIRECT_ONLY (sem proxy — URL muda para cgraf.online):
 *   Rules > Redirect Rules > Create rule
 *   When: Hostname equals painel.cgraf.online
 *   Then: Dynamic redirect -> concat("https://cgraf.online/painel/setor", http.request.uri.path)
 *   (ou estatico: https://cgraf.online/painel/setor)
 */
const ZROK_HOST = "sagra-painel.shares.zrok.io";

/** Raiz do subdominio abre o painel setor */
const DEFAULT_PAINEL_PATH = "/painel/setor";

const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "cookie",
  "if-none-match",
  "if-modified-since",
  "if-range",
  "if-match",
  "if-unmodified-since",
  "range",
  "user-agent",
  "referer",
  "authorization",
  "x-requested-with",
]);

/** Mapeia URL publica (painel.cgraf.online) para path no zrok/backend */
function upstreamPath(pathname) {
  const p = pathname || "/";
  if (p === "/" || p === "/setor") return DEFAULT_PAINEL_PATH;
  if (p === "/global") return "/painel/global";
  if (p.startsWith("/sagra/")) {
    if (p.startsWith("/sagra/api")) return p;
    return p.slice(6) || "/";
  }
  if (p.startsWith("/painel/")) return p;
  if (p.startsWith("/assets/") || p.startsWith("/api/")) return p;
  return DEFAULT_PAINEL_PATH;
}

function rewritePublicUrls(body, publicOrigin) {
  if (!body) return body;
  const zrokRe = new RegExp(`https?://${ZROK_HOST.replace(/\./g, "\\.")}`, "gi");
  const cgrafRe = /https?:\/\/(www\.)?cgraf\.online/gi;
  return body.replace(zrokRe, publicOrigin).replace(cgrafRe, publicOrigin);
}

function rewriteLocationHeader(location, publicOrigin) {
  if (!location) return location;
  try {
    const loc = new URL(location, `https://${ZROK_HOST}`);
    if (loc.hostname === ZROK_HOST) {
      return `${publicOrigin}${loc.pathname}${loc.search}${loc.hash}`;
    }
    if (loc.hostname === "cgraf.online" || loc.hostname === "www.cgraf.online") {
      return `${publicOrigin}${loc.pathname}${loc.search}${loc.hash}`;
    }
  } catch {
    /* relativo */
  }
  return rewritePublicUrls(location, publicOrigin);
}

function buildUpstreamHeaders(request, publicHost) {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (lower.startsWith("cf-") || lower.startsWith("x-forwarded-")) continue;
    if (lower === "host") continue;
    if (FORWARD_REQUEST_HEADERS.has(lower)) headers.set(key, value);
  }
  headers.set("Host", ZROK_HOST);
  headers.set("X-Forwarded-Host", publicHost);
  headers.set("X-Forwarded-Proto", "https");
  return headers;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const publicOrigin = `${url.protocol}//${url.host}`;
    const upstream = upstreamPath(url.pathname);
    const targetUrl = `https://${ZROK_HOST}${upstream}${url.search}`;

    const init = {
      method: request.method,
      headers: buildUpstreamHeaders(request, url.host),
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    let response;
    try {
      response = await fetch(targetUrl, init);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Bad Gateway",
          message: String(err.message || err),
          hint: "Confira se o share zrok sagra-painel esta ativo (iniciar-zrok-painel.bat).",
        }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location) {
        const out = new Headers();
        out.set("Location", rewriteLocationHeader(location, publicOrigin));
        return new Response(null, { status: response.status, headers: out });
      }
    }

    const contentType = response.headers.get("Content-Type") || "";
    const shouldRewrite =
      contentType.includes("text/html") ||
      contentType.includes("javascript") ||
      contentType.includes("json") ||
      contentType.includes("text/css");

    if (!shouldRewrite) return response;

    let body = await response.text();
    body = rewritePublicUrls(body, publicOrigin);

    const outHeaders = new Headers(response.headers);
    outHeaders.delete("content-length");
    outHeaders.delete("content-encoding");

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    });
  },
};
