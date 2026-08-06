import { OS_TEXT_SEARCH_MIN_CHARS } from "@/features/os/osSearchUtils";

import type { CotasGrafSearchFilters } from "./types";

export function hasCotasGrafTextFilterBelowMinLength(
  filters: CotasGrafSearchFilters,
): boolean {
  const hasAnchor =
    filters.nrOs != null ||
    filters.ano != null ||
    filters.produtos.length > 0 ||
    filters.solicitantes.length > 0;
  if (hasAnchor) {
    return false;
  }
  const titulo = (filters.titulo ?? "").trim();
  return titulo.length > 0 && titulo.length < OS_TEXT_SEARCH_MIN_CHARS;
}

export function getCotasGrafTextFilterMinLengthHint(
  filters: CotasGrafSearchFilters,
): string | null {
  if (!hasCotasGrafTextFilterBelowMinLength(filters)) {
    return null;
  }
  return `Digite pelo menos ${OS_TEXT_SEARCH_MIN_CHARS} caracteres em Título`;
}

export function getCotasGrafActiveFilterLabels(
  filters: CotasGrafSearchFilters,
): string[] {
  const active: string[] = [];
  if (filters.nrOs != null) active.push("Nr OS");
  if (filters.ano != null) {
    active.push(filters.anoMode === "from" ? "Ano (a partir de)" : "Ano");
  }
  if (filters.produtos.length) active.push("Produto");
  else if (filters.produto?.trim()) active.push("Produto");
  if (filters.titulo?.trim()) active.push("Título");
  if (filters.solicitantes.length) active.push("Solicitante");
  else if (filters.solicitante?.trim()) active.push("Solicitante");
  if (filters.situacaoCotas.length) active.push("Situação Cotas");
  if (filters.includeFinished) active.push("Entregues/Canceladas");
  return active;
}

export function getCotasGrafImplicitFilterHints(
  filters: CotasGrafSearchFilters,
): string[] {
  const hints: string[] = [];
  if (!filters.includeFinished) {
    hints.push("exclui entregues e canceladas");
  }
  if (filters.ano != null) {
    if (filters.anoMode === "from") {
      hints.push(`a partir de ${filters.ano}`);
    } else {
      hints.push(`restrito ao ano ${filters.ano}`);
    }
  }
  if (!filters.includeOs) {
    hints.push("sem OS (nº < 5000)");
  }
  if (!filters.includeSp) {
    hints.push("sem SP (nº ≥ 5000)");
  }
  return hints;
}
