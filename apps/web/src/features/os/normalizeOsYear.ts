/** Converte ano de OS para 4 dígitos (ex.: 26 → 2026). */
export function normalizeOsYear(value: string | number): number | null {
  const raw =
    typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  const year = Math.trunc(raw);
  if (year < 100) {
    return 2000 + year;
  }
  return year;
}
