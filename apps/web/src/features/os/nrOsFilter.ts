import type { OsSearchFilters } from "./types";

/** Teto de Nr OS por busca (espelha `OS_SEARCH_MAX_NR_OS_ITEMS` do backend). */
export const OS_NR_OS_FILTER_MAX_ITEMS = 100;

/**
 * Lê o campo "Nr OS" da home: aceita vários números separados por vírgula,
 * ponto e vírgula ou espaço. Ignora vazios/não numéricos e duplicatas.
 */
export function parseNrOsInput(raw: string): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const digits = part.replace(/\D/g, "");
    if (!digits) {
      continue;
    }
    const value = Number.parseInt(digits, 10);
    if (!Number.isFinite(value) || value <= 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
    if (result.length >= OS_NR_OS_FILTER_MAX_ITEMS) {
      break;
    }
  }
  return result;
}

/**
 * Patch de filtros a partir dos números digitados. `nrOs` guarda o primeiro
 * (mantém âncora/lookup exato); `nrOsList` só existe com 2+ números.
 */
export function nrOsPatchFromValues(
  values: number[],
): Pick<OsSearchFilters, "nrOs" | "nrOsList"> {
  if (values.length === 0) {
    return { nrOs: undefined, nrOsList: undefined };
  }
  return {
    nrOs: values[0],
    nrOsList: values.length > 1 ? values : undefined,
  };
}

/** Todos os Nr OS ativos no filtro (lista ou único). */
export function getNrOsFilterValues(
  filters: Pick<OsSearchFilters, "nrOs" | "nrOsList">,
): number[] {
  const list = (filters.nrOsList ?? []).filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  if (list.length > 0) {
    return list;
  }
  if (filters.nrOs != null && !Number.isNaN(filters.nrOs)) {
    return [filters.nrOs];
  }
  return [];
}

/** Texto do campo a partir dos filtros (ex.: "2244, 2250"). */
export function formatNrOsFilter(
  filters: Pick<OsSearchFilters, "nrOs" | "nrOsList">,
): string {
  return getNrOsFilterValues(filters).join(", ");
}
