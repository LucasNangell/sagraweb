import { useEffect } from "react";

const MAIN_TITLE = "SAGRA Web";
const MAIN_APPLE_TITLE = "SAGRA";
const MAIN_THEME = "#121214";
const MAIN_ICON = "icons/icon-192.png";
const MAIN_MANIFEST = "manifest.webmanifest";

const PAINEL_TITLE = "Painel OS";
const PAINEL_THEME = "#0f172a";
const PAINEL_ICON = "icons/painel-os-192.png";
const PAINEL_MANIFEST = "manifest-painel-os.webmanifest";

function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.replace(/^\//, "");
  return `${normalizedBase}${normalizedPath}`;
}

function ensureLink(
  rel: string,
  attrs: Record<string, string> = {},
): HTMLLinkElement {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function ensureMeta(name: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  return el;
}

function applyHead(mode: "painel" | "main"): void {
  const isPainel = mode === "painel";
  const manifestHref = withBase(isPainel ? PAINEL_MANIFEST : MAIN_MANIFEST);
  const iconHref = withBase(isPainel ? PAINEL_ICON : MAIN_ICON);
  const title = isPainel ? PAINEL_TITLE : MAIN_TITLE;
  const appleTitle = isPainel ? PAINEL_TITLE : MAIN_APPLE_TITLE;
  const theme = isPainel ? PAINEL_THEME : MAIN_THEME;

  document.title = title;

  const manifest = ensureLink("manifest");
  manifest.href = manifestHref;

  ensureMeta("theme-color").content = theme;
  ensureMeta("apple-mobile-web-app-title").content = appleTitle;

  const appleIcon = ensureLink("apple-touch-icon", { sizes: "192x192" });
  appleIcon.href = iconHref;

  const icon192 = document.head.querySelector<HTMLLinkElement>(
    'link[rel="icon"][sizes="192x192"]',
  );
  if (icon192) {
    icon192.href = iconHref;
  }
}

/**
 * Troca o Web App Manifest e metas Apple para o PWA “Painel OS”
 * enquanto a rota ativa for o painel tablet (ou login com redirect para ele).
 */
export function usePainelOsManifest(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    applyHead("painel");
    return () => {
      applyHead("main");
    };
  }, [enabled]);
}

/** true quando a URL atual é o painel tablet/celular ou login com redirect para eles. */
export function isPainelOsInstallContext(
  pathname: string,
  redirect?: string | null,
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (
    path === "/painel/tablet" ||
    path.endsWith("/painel/tablet") ||
    path === "/painel/celular" ||
    path.endsWith("/painel/celular")
  ) {
    return true;
  }
  if (path === "/login" || path.endsWith("/login")) {
    if (
      redirect === "/painel/tablet" ||
      redirect?.endsWith("/painel/tablet") ||
      redirect === "/painel/celular" ||
      redirect?.endsWith("/painel/celular")
    ) {
      return true;
    }
  }
  return false;
}
