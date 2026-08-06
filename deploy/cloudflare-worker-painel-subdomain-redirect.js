/**
 * Cloudflare Worker: painel.cgraf.online -> redirect para cgraf.online
 *
 * Use este arquivo se quiser APENAS redirecionar o navegador (URL muda para cgraf.online).
 * Para manter painel.cgraf.online na barra de enderecos, use cloudflare-worker-painel-subdomain.js
 *
 * Rota: painel.cgraf.online/*
 */
const TARGET_ORIGIN = "https://cgraf.online";

function targetUrl(pathname, search) {
  if (pathname === "/" || pathname === "/setor") {
    return `${TARGET_ORIGIN}/painel/setor${search}`;
  }
  if (pathname === "/global") {
    return `${TARGET_ORIGIN}/painel/global${search}`;
  }
  if (pathname.startsWith("/sagra/")) {
    if (pathname.startsWith("/sagra/api")) {
      return `${TARGET_ORIGIN}${pathname}${search}`;
    }
    const dest = pathname.slice(6) || "/";
    return `${TARGET_ORIGIN}${dest}${search}`;
  }
  return `${TARGET_ORIGIN}/painel/setor${search}`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(targetUrl(url.pathname, url.search), 302);
  },
};
