/** Converte caminho relativo da pasta da OS (ex.: Sefoc/arquivo.pdf) para envio à API. */
export function osRelativePathToProofFilename(relative: string): string | null {
  const norm = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const lower = norm.toLowerCase();
  const prefix = "sefoc/";
  const idx = lower.indexOf(prefix);
  if (idx === -1) {
    return null;
  }
  const withinSefoc = norm.slice(idx + prefix.length);
  if (!withinSefoc.toLowerCase().endsWith(".pdf")) {
    return null;
  }
  return withinSefoc;
}

const PROVA_SEFOC_RE = /ProvaSefoc (\d+)\.pdf$/i;
const PROVA_SEFOC_LEGACY_RE = /Prova(\d+)_SEFOC\.pdf$/i;

/** Espelho de extract_prova_version_from_filename no backend. */
export function extractProvaVersionFromFilename(
  filename: string,
): number | null {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  const m1 = PROVA_SEFOC_RE.exec(base);
  if (m1) return Number.parseInt(m1[1], 10);
  const m2 = PROVA_SEFOC_LEGACY_RE.exec(base);
  if (m2) return Number.parseInt(m2[1], 10);
  return null;
}

/**
 * Adota `suggested` quando a ProvaSefoc dele for maior que a do selecionado
 * (ou o selecionado não tiver versão). Não regressa para versão menor.
 */
export function shouldAdoptSuggestedProof(
  selected: string,
  suggested: string | null | undefined,
): boolean {
  if (!suggested || suggested === selected) return false;
  if (!selected) return true;
  const sugVer = extractProvaVersionFromFilename(suggested);
  if (sugVer == null) return false;
  const selVer = extractProvaVersionFromFilename(selected);
  if (selVer == null) return true;
  return sugVer > selVer;
}
