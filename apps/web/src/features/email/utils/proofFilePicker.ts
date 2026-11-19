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

/** PDF com «Prova» no nome (não confunde com «Aprovado»). */
const PROVA_NAME_RE = /(?<![a-z])prova/i;
/** ProvaSefoc 3, Prova3_SEFOC, -Prova3, Prova 3, Prova_3 … */
const PROVA_NUM_RE = /(?<![a-z])prova(?:\s*sefoc)?[\s_-]*(\d{1,3})(?!\d)/gi;

function baseName(filename: string): string {
  return filename.replace(/\\/g, "/").split("/").pop() ?? filename;
}

/** Espelho de is_prova_filename no backend. */
export function isProvaFilename(filename: string): boolean {
  const base = baseName(filename);
  if (!/\.pdf$/i.test(base)) return false;
  return PROVA_NAME_RE.test(base.slice(0, -4));
}

/** Espelho de extract_prova_version_from_filename no backend (maior número). */
export function extractProvaVersionFromFilename(
  filename: string,
): number | null {
  const base = baseName(filename).replace(/\.pdf$/i, "");
  let best: number | null = null;
  for (const match of base.matchAll(PROVA_NUM_RE)) {
    const value = Number.parseInt(match[1], 10);
    if (value > 0 && (best == null || value > best)) best = value;
  }
  return best;
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
