import { OS_TEXT_SEARCH_MIN_CHARS } from "@/features/os/osSearchUtils";

import type { CotasGrafSearchFilters } from "./types";

function textMeetsMinLength(
  value: string | undefined,
  hasAnchor: boolean,
): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return true;
  }
  if (hasAnchor) {
    return true;
  }
  return trimmed.length >= OS_TEXT_SEARCH_MIN_CHARS;
}

export function buildCotasGrafSearchFilters(
  filters: CotasGrafSearchFilters,
  debouncedText: Pick<CotasGrafSearchFilters, "nrOs" | "titulo">,
): CotasGrafSearchFilters {
  const hasAnchor =
    debouncedText.nrOs != null ||
    filters.nrOs != null ||
    filters.ano != null ||
    filters.produtos.length > 0 ||
    filters.solicitantes.length > 0;

  return {
    ...filters,
    nrOs: debouncedText.nrOs,
    titulo: textMeetsMinLength(debouncedText.titulo, hasAnchor)
      ? debouncedText.titulo
      : "",
  };
}
