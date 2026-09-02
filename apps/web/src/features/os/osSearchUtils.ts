import { digitsOnly, PROCESSO_MIN_FILTER_DIGITS } from "./processoMask";
import type { OsSearchFilters, OsSearchResponse, OsSearchRow } from "./types";

/** Mínimo de caracteres para disparar busca textual pesada (espelha backend). */
export const OS_TEXT_SEARCH_MIN_CHARS = 3;

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

function processoMeetsMinDigits(value: string | undefined): boolean {
  const digits = digitsOnly(value ?? "");
  if (!digits) {
    return true;
  }
  return digits.length >= PROCESSO_MIN_FILTER_DIGITS;
}

export type OsHomeDebouncedText = Pick<
  OsSearchFilters,
  | "nrOs"
  | "titulo"
  | "processo"
  | "papel"
  | "cores"
  | "acabamento"
  | "observacao"
>;

/** Campos extras da faixa avançada (home). */
export function hasOsHomeAdvancedFilters(filters: OsSearchFilters): boolean {
  return Boolean(
    (filters.formatos?.length ?? 0) > 0 ||
      (filters.papel ?? "").trim() ||
      (filters.cores ?? "").trim() ||
      (filters.acabamento ?? "").trim() ||
      (filters.observacao ?? "").trim() ||
      (filters.dataEntradaDe ?? "").trim() ||
      (filters.dataEntradaAte ?? "").trim(),
  );
}

/** Ativa lookup exato quando Nr OS está preenchido (prioriza localizar a OS). */
export function isExactOsLookup(filters: Pick<OsSearchFilters, "nrOs">): boolean {
  return filters.nrOs != null && !Number.isNaN(filters.nrOs);
}

/** Filtros efetivos da busca na home (título/Nr OS/processo com debounce; demais imediatos). */
export function buildOsHomeSearchFilters(
  filters: OsSearchFilters,
  debouncedText: OsHomeDebouncedText,
): OsSearchFilters {
  // Ano default da home NÃO é âncora — evita FULLTEXT a cada 1–2 teclas.
  const hasAnchor =
    debouncedText.nrOs != null ||
    filters.nrOs != null ||
    filters.produtos.length > 0 ||
    filters.solicitantes.length > 0;

  const merged: OsSearchFilters = {
    ...filters,
    nrOs: debouncedText.nrOs,
    titulo: textMeetsMinLength(debouncedText.titulo, hasAnchor)
      ? debouncedText.titulo
      : "",
    processo: processoMeetsMinDigits(debouncedText.processo)
      ? digitsOnly(debouncedText.processo ?? "")
      : "",
    papel: textMeetsMinLength(debouncedText.papel, hasAnchor)
      ? debouncedText.papel
      : "",
    cores: textMeetsMinLength(debouncedText.cores, hasAnchor)
      ? debouncedText.cores
      : "",
    acabamento: textMeetsMinLength(debouncedText.acabamento, hasAnchor)
      ? debouncedText.acabamento
      : "",
    observacao: textMeetsMinLength(debouncedText.observacao, hasAnchor)
      ? debouncedText.observacao
      : "",
  };
  const exactOsLookup = isExactOsLookup(merged);
  return {
    ...merged,
    includeFinished: true,
    exactOsLookup,
    page: exactOsLookup ? 1 : merged.page,
  };
}

/** Chave estável para React Query (ordena arrays, trim strings). */
export function normalizeOsSearchFilters(
  filters: OsSearchFilters,
): OsSearchFilters {
  return {
    nrOs: filters.nrOs,
    anos: [...(filters.anos ?? [])].sort((a, b) => a - b),
    produto: (filters.produto ?? "").trim(),
    produtos: [...filters.produtos].sort(),
    titulo: (filters.titulo ?? "").trim(),
    processo: digitsOnly(filters.processo ?? ""),
    solicitante: (filters.solicitante ?? "").trim(),
    solicitantes: [...filters.solicitantes].sort(),
    categorias: [...(filters.categorias ?? [])].sort(),
    maquinas: [...(filters.maquinas ?? [])].sort(),
    situacao: [...filters.situacao].sort(),
    setor: [...filters.setor].sort(),
    prioridade: [...filters.prioridade].sort(),
    formatos: [...(filters.formatos ?? [])].sort(),
    papel: (filters.papel ?? "").trim(),
    cores: (filters.cores ?? "").trim(),
    acabamento: (filters.acabamento ?? "").trim(),
    observacao: (filters.observacao ?? "").trim(),
    dataEntradaDe: (filters.dataEntradaDe ?? "").trim(),
    dataEntradaAte: (filters.dataEntradaAte ?? "").trim(),
    includeFinished: filters.includeFinished,
    includeOs: filters.includeOs,
    includeSp: filters.includeSp,
    page: filters.page,
    limit: filters.limit,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    exactOsLookup: filters.exactOsLookup === true,
    fetchAll: filters.fetchAll === true,
  };
}

/** Uma linha por OS principal ou por Sub OS (nr_os + ano + sub_os_id). */
export function dedupeOsSearchRows(rows: OsSearchRow[]): OsSearchRow[] {
  const seen = new Set<string>();
  const result: OsSearchRow[] = [];
  for (const row of rows) {
    const kind = row.kind === "sub_os" || row.is_sub_os ? "sub_os" : "main_os";
    const key =
      kind === "sub_os"
        ? `${row.nr_os}-${row.ano}-sub-${row.sub_os_id ?? "?"}`
        : `${row.nr_os}-${row.ano}-main`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }
  return result;
}

export function dedupeOsSearchResponse(res: OsSearchResponse): OsSearchResponse {
  return {
    ...res,
    data: dedupeOsSearchRows(res.data),
  };
}
