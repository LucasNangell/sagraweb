import { useEffect } from "react";

export type PainelPwaVariant = "tablet" | "setor-moderno";

const MAIN_TITLE = "SAGRA Web";
const MAIN_APPLE_TITLE = "SAGRA";
const MAIN_THEME = "#121214";
const MAIN_ICON = "icons/icon-192.png";
const MAIN_ICON_32 = "icons/favicon-32.png";
const MAIN_MANIFEST = "manifest.webmanifest";

const PAINEL_THEME = "#0f172a";
const PAINEL_ICON = "icons/painel-os-192.png";

const TABLET_TITLE = "Painel OS";
const TABLET_MANIFEST = "manifest-painel-os.webmanifest";

const SETOR_MODERNO_TITLE = "Painel Setor";
const SETOR_MODERNO_MANIFEST = "manifest-painel-setor-moderno.webmanifest";

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

function applyHead(mode: "main" | PainelPwaVariant): void {
  const isPainel = mode !== "main";
  const isSetorModerno = mode === "setor-moderno";
  const manifestHref = withBase(
    isSetorModerno
      ? SETOR_MODERNO_MANIFEST
      : isPainel
        ? TABLET_MANIFEST
        : MAIN_MANIFEST,
  );
  const iconHref = withBase(isPainel ? PAINEL_ICON : MAIN_ICON);
  const icon32Href = withBase(isPainel ? PAINEL_ICON : MAIN_ICON_32);
  const title = isSetorModerno
    ? SETOR_MODERNO_TITLE
    : isPainel
      ? TABLET_TITLE
      : MAIN_TITLE;
  const appleTitle = isSetorModerno
    ? SETOR_MODERNO_TITLE
    : isPainel
      ? TABLET_TITLE
      : MAIN_APPLE_TITLE;
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

  const icon32 = document.head.querySelector<HTMLLinkElement>(
    'link[rel="icon"][sizes="32x32"][type="image/png"]',
  );
  if (icon32) {
    icon32.href = icon32Href;
  }
}

/**
 * Troca o Web App Manifest e metas Apple para o PWA do painel
 * enquanto a rota ativa for o tablet/setor moderno (ou login com redirect).
 */
export function usePainelOsManifest(
  enabled: boolean,
  variant: PainelPwaVariant = "tablet",
): void {
  useEffect(() => {
    if (!enabled) return;
    applyHead(variant);
    return () => {
      applyHead("main");
    };
  }, [enabled, variant]);
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

function matchesPath(value: string, route: string): boolean {
  return value === route || value.endsWith(route);
}

function isTabletPainelPath(value: string): boolean {
  return (
    matchesPath(value, "/painel/tablet") ||
    matchesPath(value, "/painel/celular") ||
    matchesPath(value, "/painel/gravacao")
  );
}

function isSetorModernoPath(value: string): boolean {
  return matchesPath(value, "/painel/setor-moderno");
}

/** Variante de PWA/ícone a aplicar, ou null fora do contexto de instalação do painel. */
export function getPainelOsInstallVariant(
  pathname: string,
  redirect?: string | null,
): PainelPwaVariant | null {
  const path = normalizePath(pathname);
  if (isSetorModernoPath(path)) {
    return "setor-moderno";
  }
  if (isTabletPainelPath(path)) {
    return "tablet";
  }
  if (path === "/login" || path.endsWith("/login")) {
    if (!redirect) {
      return null;
    }
    const redirectPath = normalizePath(redirect);
    if (isSetorModernoPath(redirectPath)) {
      return "setor-moderno";
    }
    if (isTabletPainelPath(redirectPath)) {
      return "tablet";
    }
  }
  return null;
}

/** true quando a URL atual é o painel tablet/celular/gravação/setor moderno ou login com redirect para eles. */
export function isPainelOsInstallContext(
  pathname: string,
  redirect?: string | null,
): boolean {
  return getPainelOsInstallVariant(pathname, redirect) != null;
}
