/** Rotas dos painéis exibidas sem AppShell (header/sidebar). */
export const PAINEL_STANDALONE_PATHS = [
  "/painel/setor",
  "/painel/setor-moderno",
  "/painel/global",
  "/painel/tablet",
  "/painel/celular",
  "/painel/gravacao",
] as const;

export type PainelStandalonePath = (typeof PAINEL_STANDALONE_PATHS)[number];

export function isPainelStandalonePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, "") || "/";
  return (PAINEL_STANDALONE_PATHS as readonly string[]).includes(normalized);
}

function buildPainelAbsoluteUrl(path: PainelStandalonePath): string {
  const base = import.meta.env.BASE_URL;
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const pathWithoutLeadingSlash = path.startsWith("/") ? path.slice(1) : path;
  return new URL(`${baseWithSlash}${pathWithoutLeadingSlash}`, window.location.origin)
    .href;
}

/** Abre o painel em nova janela maximizada (sem chrome do sistema). */
export function openPainelInNewWindow(path: PainelStandalonePath): boolean {
  const url = buildPainelAbsoluteUrl(path);
  const windowName =
    path === "/painel/setor-moderno" ? "SagraPainelSetorModerno" :
    path === "/painel/setor" ? "SagraPainelSetor" : "SagraPainelGlobal";

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
    window.alert(
      "Não foi possível abrir o painel. Verifique se o bloqueador de pop-ups está desativado para este site.",
    );
    return false;
  }

  win.focus();
  return true;
}
