/**
 * Converte redirect legado (/sagra/...) para rota do React Router (base /).
 */
export function normalizeAppRedirect(
  raw: string | undefined,
): string | undefined {
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  const path = raw.split("?")[0].split("#")[0].trim();
  if (!path) {
    return undefined;
  }
  if (path === "/sagra" || path === "/sagra/") {
    return "/";
  }
  if (path.startsWith("/sagra/")) {
    const rest = path.slice("/sagra".length) || "/";
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}
