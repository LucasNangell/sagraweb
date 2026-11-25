import { useEffect } from "react";

export type PainelPwaVariant = "tablet" | "setor-moderno";

/** Variantes de PWA instalável com manifest próprio. */
export type SagraPwaVariant = PainelPwaVariant | "manutencao";

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

const MANUTENCAO_TITLE = "SAGRA Manutenção";
const MANUTENCAO_APPLE_TITLE = "Manutenção";
const MANUTENCAO_MANIFEST = "manifest-manutencao.webmanifest";
const MANUTENCAO_ICON = "icons/manutencao-192.png";

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

interface HeadConfig {
  manifest: string;
  icon: string;
  icon32: string;
  title: string;
  appleTitle: string;
  theme: string;
}

const HEAD_CONFIG: Record<"main" | SagraPwaVariant, HeadConfig> = {
  main: {
    manifest: MAIN_MANIFEST,
    icon: MAIN_ICON,
    icon32: MAIN_ICON_32,
    title: MAIN_TITLE,
    appleTitle: MAIN_APPLE_TITLE,
    theme: MAIN_THEME,
  },
  tablet: {
    manifest: TABLET_MANIFEST,
    icon: PAINEL_ICON,
    icon32: PAINEL_ICON,
    title: TABLET_TITLE,
    appleTitle: TABLET_TITLE,
    theme: PAINEL_THEME,
  },
  "setor-moderno": {
    manifest: SETOR_MODERNO_MANIFEST,
    icon: PAINEL_ICON,
    icon32: PAINEL_ICON,
    title: SETOR_MODERNO_TITLE,
    appleTitle: SETOR_MODERNO_TITLE,
    theme: PAINEL_THEME,
  },
  manutencao: {
    manifest: MANUTENCAO_MANIFEST,
    icon: MANUTENCAO_ICON,
    icon32: MANUTENCAO_ICON,
    title: MANUTENCAO_TITLE,
    appleTitle: MANUTENCAO_APPLE_TITLE,
    theme: PAINEL_THEME,
  },
};

function applyHead(mode: "main" | SagraPwaVariant): void {
  const cfg = HEAD_CONFIG[mode];
  const iconHref = withBase(cfg.icon);

  document.title = cfg.title;

  const manifest = ensureLink("manifest");
  manifest.href = withBase(cfg.manifest);

  ensureMeta("theme-color").content = cfg.theme;
  ensureMeta("apple-mobile-web-app-title").content = cfg.appleTitle;

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
    icon32.href = withBase(cfg.icon32);
  }
}

/**
 * Troca o Web App Manifest e metas Apple para o PWA do painel
 * enquanto a rota ativa for o tablet/setor moderno (ou login com redirect).
 */
export function usePainelOsManifest(
  enabled: boolean,
  variant: SagraPwaVariant = "tablet",
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

function isManutencaoPath(value: string): boolean {
  return matchesPath(value, "/manutencao");
}

/** Variante de PWA/ícone a aplicar, ou null fora do contexto de instalação do painel. */
export function getPainelOsInstallVariant(
  pathname: string,
  redirect?: string | null,
): SagraPwaVariant | null {
  const path = normalizePath(pathname);
  if (isSetorModernoPath(path)) {
    return "setor-moderno";
  }
  if (isTabletPainelPath(path)) {
    return "tablet";
  }
  if (isManutencaoPath(path)) {
    return "manutencao";
  }
  if (path === "/login" || path.endsWith("/login")) {
    if (!redirect) {
      return null;
    }
    const redirectPath = normalizePath(redirect.split(/[?#]/)[0] ?? "");
    if (isManutencaoPath(redirectPath)) {
      return "manutencao";
    }
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
