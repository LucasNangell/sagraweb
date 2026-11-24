import type { PainelOsRoute } from "@/api/painelRemote";
import { toast } from "@/components/ui/toastStore";
import { isValidPainelClientId } from "@/features/dashboard-setor/painelClientId";

/** Rotas dos painéis exibidas sem AppShell (header/sidebar). */
export const PAINEL_STANDALONE_PATHS = [
  "/painel/setor",
  "/painel/setor-moderno",
  "/painel/global",
  "/painel/tablet",
  "/painel/celular",
  "/painel/gravacao",
  "/painel/preview-admin",
] as const;

export type PainelStandalonePath = (typeof PAINEL_STANDALONE_PATHS)[number];

const PAINEL_OS_MIRROR_ROUTES: readonly PainelOsRoute[] = [
  "setor",
  "setor-moderno",
  "tablet",
  "celular",
];

export function isPainelStandalonePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, "") || "/";
  return (PAINEL_STANDALONE_PATHS as readonly string[]).includes(normalized);
}

function buildPainelAbsoluteUrl(
  path: PainelStandalonePath,
  searchParams?: URLSearchParams,
): string {
  const base = import.meta.env.BASE_URL;
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const pathWithoutLeadingSlash = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(
    `${baseWithSlash}${pathWithoutLeadingSlash}`,
    window.location.origin,
  );
  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  return url.href;
}

function painelWindowName(
  path: PainelStandalonePath,
  suffix = "",
): string {
  const base =
    path === "/painel/preview-admin"
      ? "SagraPainelPreview"
      : path === "/painel/setor-moderno"
        ? "SagraPainelSetorModerno"
        : path === "/painel/setor"
          ? "SagraPainelSetor"
          : path === "/painel/tablet"
            ? "SagraPainelTablet"
            : path === "/painel/celular"
              ? "SagraPainelCelular"
              : "SagraPainelGlobal";
  return suffix ? `${base}_${suffix}` : base;
}

/** Abre o painel em nova janela maximizada (sem chrome do sistema). */
export function openPainelInNewWindow(
  path: PainelStandalonePath,
  options?: { searchParams?: URLSearchParams; windowName?: string },
): boolean {
  const url = buildPainelAbsoluteUrl(path, options?.searchParams);
  const windowName = options?.windowName ?? painelWindowName(path);

  const width = window.screen.availWidth;
  const height = window.screen.availHeight;
  const left = window.screen.availLeft ?? 0;
  const top = window.screen.availTop ?? 0;

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "scrollbars=yes",
    "resizable=yes",
  ].join(",");

  const win = window.open(url, windowName, features);

  if (!win) {
    toast.error("Não foi possível abrir o painel. Verifique se o bloqueador de pop-ups está desativado para este site.",);
    return false;
  }

  win.focus();
  return true;
}

/** Preview do admin em janela própria, simulando o painel moderno. */
export function openPainelPreviewWindow(): boolean {
  return openPainelInNewWindow("/painel/preview-admin");
}

export function painelOsRouteToPath(
  route: string,
): Extract<
  PainelStandalonePath,
  "/painel/setor" | "/painel/setor-moderno" | "/painel/tablet" | "/painel/celular"
> | null {
  if ((PAINEL_OS_MIRROR_ROUTES as readonly string[]).includes(route)) {
    return `/painel/${route}` as Extract<
      PainelStandalonePath,
      | "/painel/setor"
      | "/painel/setor-moderno"
      | "/painel/tablet"
      | "/painel/celular"
    >;
  }
  return null;
}

/** Abre uma janela espelhando a config/rota do computador listado em Exibindo agora. */
export function openPainelMirrorWindow(
  route: string,
  clientId: string,
): boolean {
  const path = painelOsRouteToPath(route);
  if (!path) {
    toast.error("Rota de painel desconhecida para espelhamento.");
    return false;
  }
  if (!isValidPainelClientId(clientId)) {
    toast.error("Identificador do painel inválido.");
    return false;
  }
  const searchParams = new URLSearchParams({ mirror: clientId.trim() });
  return openPainelInNewWindow(path, {
    searchParams,
    windowName: painelWindowName(path, clientId.trim()),
  });
}
