import { OS_TEXT_SEARCH_MIN_CHARS } from "./osSearchUtils";
import type { OsSearchFilters } from "./types";

const MAX_VALUES_SHOWN = 3;

/** True se título legado ou textos avançados têm 1–2 caracteres sem âncora. */
export function hasTextFilterBelowMinLength(filters: OsSearchFilters): boolean {
  const hasAnchor =
    filters.nrOs != null ||
    filters.produtos.length > 0 ||
    filters.solicitantes.length > 0;
  const short = (value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 && trimmed.length < OS_TEXT_SEARCH_MIN_CHARS;
  };
  if (hasAnchor) {
    return false;
  }
  return (
    short(filters.titulo) ||
    short(filters.papel) ||
    short(filters.cores) ||
    short(filters.acabamento) ||
    short(filters.observacao)
  );
}

export function getTextFilterMinLengthHint(filters: OsSearchFilters): string | null {
  if (!hasTextFilterBelowMinLength(filters)) {
    return null;
  }
  const short = (value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 && trimmed.length < OS_TEXT_SEARCH_MIN_CHARS;
  };
  const fields: [string | undefined, string][] = [
    [filters.titulo, "Título"],
    [filters.papel, "Papel"],
    [filters.cores, "Cores"],
    [filters.acabamento, "Acabamento"],
    [filters.observacao, "Observação"],
  ];
  const named = fields.find(([value]) => short(value));
  const label = named?.[1] ?? "Título";
  return `Digite pelo menos ${OS_TEXT_SEARCH_MIN_CHARS} caracteres em ${label}`;
}

function summarizeValues(values: string[], max = MAX_VALUES_SHOWN): string {
  if (values.length === 0) return "";
  if (values.length <= max) return values.join(", ");
  const shown = values.slice(0, max).join(", ");
  return `${shown} +${values.length - max}`;
}

/** Rótulos dos campos de filtro preenchidos pelo usuário. */
export function getActiveFilterLabels(filters: OsSearchFilters): string[] {
  const active: string[] = [];
  if (filters.nrOs != null) active.push("Nr OS");
  if ((filters.anos ?? []).length) active.push("Ano");
  else if (filters.ano != null) active.push("Ano");
  if (filters.processo?.trim()) active.push("Processo");
  if ((filters.categorias ?? []).length) active.push("Categoria");
  if (filters.produtos.length) active.push("Produto");
  else if (filters.produto?.trim()) active.push("Produto");
  if (filters.titulo?.trim()) active.push("Título");
  if (filters.solicitantes.length) active.push("Solicitante");
  else if (filters.solicitante?.trim()) active.push("Solicitante");
  if ((filters.maquinas ?? []).length) active.push("Máquina");
  if (filters.situacao.length) active.push("Situação");
  if (filters.setor.length) active.push("Setor");
  if (filters.prioridade.length) active.push("Prioridade");
  if ((filters.formatos ?? []).length) active.push("Formato");
  if (filters.papel?.trim()) active.push("Papel");
  if (filters.cores?.trim()) active.push("Cores");
  if (filters.acabamento?.trim()) active.push("Acabamento");
  if (filters.observacao?.trim()) active.push("Observação");
  if (filters.dataEntradaDe?.trim() || filters.dataEntradaAte?.trim()) {
    active.push("Data de entrada");
  }
  return active;
}

/**
 * Resumo com valores aplicados (para o título "Filtros de Pesquisa: …").
 * Trunca listas longas com "+N".
 */
export function getActiveFilterValueSummary(filters: OsSearchFilters): string[] {
  const parts: string[] = [];
  if (filters.nrOs != null) parts.push(String(filters.nrOs));
  const anos = filters.anos ?? [];
  if (anos.length) parts.push(summarizeValues(anos.map(String)));
  else if (filters.ano != null) parts.push(String(filters.ano));
  if (filters.processo?.trim()) parts.push(filters.processo.trim());
  if ((filters.categorias ?? []).length) {
    parts.push(summarizeValues(filters.categorias));
  }
  if (filters.solicitantes.length) {
    parts.push(summarizeValues(filters.solicitantes));
  } else if (filters.solicitante?.trim()) {
    parts.push(filters.solicitante.trim());
  }
  if (filters.titulo?.trim()) parts.push(filters.titulo.trim());
  if (filters.produtos.length) {
    parts.push(summarizeValues(filters.produtos));
  } else if (filters.produto?.trim()) {
    parts.push(filters.produto.trim());
  }
  if ((filters.maquinas ?? []).length) {
    parts.push(summarizeValues(filters.maquinas));
  }
  if (filters.prioridade.length) {
    parts.push(summarizeValues(filters.prioridade));
  }
  if (filters.setor.length) parts.push(summarizeValues(filters.setor));
  if (filters.situacao.length) parts.push(summarizeValues(filters.situacao));
  if ((filters.formatos ?? []).length) {
    parts.push(summarizeValues(filters.formatos ?? []));
  }
  if (filters.papel?.trim()) parts.push(filters.papel.trim());
  if (filters.cores?.trim()) parts.push(filters.cores.trim());
  if (filters.acabamento?.trim()) parts.push(filters.acabamento.trim());
  if (filters.observacao?.trim()) parts.push(filters.observacao.trim());
  const de = (filters.dataEntradaDe ?? "").trim();
  const ate = (filters.dataEntradaAte ?? "").trim();
  if (de || ate) {
    parts.push([de || "…", ate || "…"].join("–"));
  }
  return parts;
}

/** Lookup exato combina com filtros de escolha — sem hint de exclusão. */
export function getExactOsLookupHint(_filters: OsSearchFilters): string | null {
  return null;
}

/** Restrições padrão da listagem (não são campos do formulário). */
export function getImplicitFilterHints(filters: OsSearchFilters): string[] {
  const hints: string[] = [];

  if (!filters.includeOs) {
    hints.push("sem OS (nº < 5000)");
  }

  if (!filters.includeSp) {
    hints.push("sem SP (nº ≥ 5000)");
  }

  return hints;
}
