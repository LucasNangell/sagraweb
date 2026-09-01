export const OS_ANO_MIN = 2000;
export const OS_ANO_MAX = 2100;

export function normalizeAno(raw: unknown): number | null {
  const n =
    typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  let ano = Math.trunc(n);
  if (ano < 100) {
    ano += 2000;
  }
  if (ano < OS_ANO_MIN || ano > OS_ANO_MAX) {
    return null;
  }
  return ano;
}

export function parseOsAnoPair(
  osRaw: unknown,
  anoRaw: unknown,
): { os: number; ano: number } | null {
  const os =
    typeof osRaw === "number"
      ? osRaw
      : Number.parseInt(String(osRaw ?? "").trim(), 10);
  const ano = normalizeAno(anoRaw);
  if (!Number.isFinite(os) || os <= 0 || ano == null) {
    return null;
  }
  return { os: Math.trunc(os), ano };
}
