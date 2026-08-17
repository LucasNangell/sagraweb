/**
 * Cloudflare Worker: cgraf.online -> zrok (SAGRA painel)
 *
 * Cole no dashboard Cloudflare (Workers) ou: wrangler deploy
 * Rota: cgraf.online/*  (links legados /sagra/* redirecionam para a raiz; /sagra/api/ mantido)
 *
 * IMPORTANTE: nao repasse cabecalhos CF-* ao zrok. Se copiar request.headers
 * inteiro, o FastAPI ve CF-Connecting-IP e aplica regras de tunel Cloudflare
 * (ou falha de proxy), diferente do acesso direto ao zrok que funciona.
 */
const ZROK_HOST = "sagra-painel.shares.zrok.io";

/** Cabecalhos seguros para repassar ao zrok */
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

function rewriteZrokUrl(value, publicOrigin) {
  if (!value) return value;
  return value.replace(
    new RegExp(`https?://${ZROK_HOST.replace(/\./g, "\\.")}`, "gi"),
    publicOrigin,
  );
}

function buildUpstreamHeaders(request, publicHost) {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (lower.startsWith("cf-") || lower.startsWith("x-forwarded-")) continue;
    if (lower === "host") continue;
    if (FORWARD_REQUEST_HEADERS.has(lower)) {
      headers.set(key, value);
    }
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

    const path = url.pathname;
    if (
      path === "/sagra" ||
      (path.startsWith("/sagra/") && !path.startsWith("/sagra/api"))
    ) {
      const dest = path === "/sagra" ? "/" : path.slice(6) || "/";
      return Response.redirect(`${publicOrigin}${dest}${url.search}`, 302);
    }

    const targetUrl = `https://${ZROK_HOST}${url.pathname}${url.search}`;

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
          hint: "Worker nao conseguiu falar com o zrok. Confira se o share sagra-painel esta ativo.",
        }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location) {
        const out = new Headers();
        out.set("Location", rewriteZrokUrl(location, publicOrigin));
        return new Response(null, { status: response.status, headers: out });
      }
    }

    const contentType = response.headers.get("Content-Type") || "";
    const shouldRewrite =
      contentType.includes("text/html") ||
      contentType.includes("javascript") ||
      contentType.includes("json") ||
      contentType.includes("text/css");

    if (!shouldRewrite) {
      return response;
    }

    let body = await response.text();
    body = rewriteZrokUrl(body, publicOrigin);

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
