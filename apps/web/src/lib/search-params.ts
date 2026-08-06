/** Normaliza parâmetros de busca (TanStack pode JSON-parse números na URL). */
export function searchParamAsString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return undefined;
}
