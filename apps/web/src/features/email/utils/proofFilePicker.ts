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
