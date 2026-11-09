/** Pasta-pai de um caminho UNC/local (sem barra final). */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash >= 0 ? trimmed.slice(0, slash) : trimmed;
}

/**
 * Converte path absoluto do arquivo para relativo à raiz da OS.
 * Retorna null se o arquivo não estiver sob a pasta da OS.
 */
export function absoluteToOsRelative(
  filePath: string,
  osRoot: string,
): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = norm(osRoot);
  const full = norm(filePath);
  if (!root || !full) return null;
  const rootLower = root.toLowerCase();
  const fullLower = full.toLowerCase();
  if (fullLower === rootLower) return "";
  const prefix = `${rootLower}/`;
  if (!fullLower.startsWith(prefix)) return null;
  return full.slice(root.length + 1);
}

export function openCompareVersoesTab(
  ano: number,
  osId: number,
  previousRelative: string,
  currentRelative: string,
): void {
  const base = import.meta.env.BASE_URL;
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const params = new URLSearchParams({
    previous: previousRelative,
    current: currentRelative,
    auto: "1",
  });
  const url = new URL(
    `${baseWithSlash}os/${ano}/${osId}/comparar-versoes?${params}`,
    window.location.origin,
  ).href;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
