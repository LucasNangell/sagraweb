import type { OsSearchFilters, OsSortColumn, OsSortDir } from "./types";

export interface OsSortKey {
  column: OsSortColumn;
  dir: OsSortDir;
}

export const OS_SORT_COLUMNS: OsSortColumn[] = [
  "nr_os",
  "ano",
  "produto",
  "titulo",
  "solicitante",
  "situacao",
  "setor",
  "prioridade",
  "data_entrada",
  "data_entrega",
];

const OS_SORT_COLUMN_SET = new Set<string>(OS_SORT_COLUMNS);

export const DEFAULT_OS_SORTS: OsSortKey[] = [{ column: "ano", dir: "asc" }];

export function isOsSortColumn(value: string): value is OsSortColumn {
  return OS_SORT_COLUMN_SET.has(value);
}

/** Fila efetiva: `sorts` se existir; senão o par legado sortBy/sortDir. */
export function resolveOsSorts(
  filters: Pick<OsSearchFilters, "sorts" | "sortBy" | "sortDir">,
): OsSortKey[] {
  if (Array.isArray(filters.sorts)) {
    return sanitizeOsSorts(filters.sorts) ?? [];
  }
  if (filters.sortBy && isOsSortColumn(filters.sortBy)) {
    return [
      {
        column: filters.sortBy,
        dir: filters.sortDir === "desc" ? "desc" : "asc",
      },
    ];
  }
  return [...DEFAULT_OS_SORTS];
}

export function sortsToFilterPatch(sorts: OsSortKey[]): Partial<OsSearchFilters> {
  const clean = sanitizeOsSorts(sorts) ?? [];
  const first = clean[0];
  return {
    sorts: clean,
    sortBy: first?.column,
    sortDir: first?.dir,
  };
}

/**
 * Clique cumulativo: sem ordem → desc; desc → asc; asc → remove (reindexa).
 */
export function cycleOsSortKeys(
  sorts: OsSortKey[],
  column: OsSortColumn,
): OsSortKey[] {
  if (!isOsSortColumn(column)) {
    return sorts;
  }
  const idx = sorts.findIndex((item) => item.column === column);
  if (idx < 0) {
    return [...sorts, { column, dir: "desc" }];
  }
  const current = sorts[idx];
  if (current?.dir === "desc") {
    const next = sorts.slice();
    next[idx] = { column, dir: "asc" };
    return next;
  }
  return sorts.filter((_, i) => i !== idx);
}

export function osSortHeaderMeta(
  sorts: OsSortKey[],
  column: string,
): { dir?: OsSortDir; badge?: string } {
  const idx = sorts.findIndex((item) => item.column === column);
  if (idx < 0) {
    return {};
  }
  return {
    dir: sorts[idx]?.dir,
    badge: `${idx + 1}º`,
  };
}

export function serializeOsSortToken(key: OsSortKey): string {
  return `${key.column}:${key.dir}`;
}

export function sanitizeOsSorts(raw: unknown): OsSortKey[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<string>();
  const result: OsSortKey[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const column = (item as OsSortKey).column;
    const dir = (item as OsSortKey).dir === "desc" ? "desc" : "asc";
    if (typeof column !== "string" || !isOsSortColumn(column) || seen.has(column)) {
      continue;
    }
    seen.add(column);
    result.push({ column, dir });
    if (result.length >= OS_SORT_COLUMNS.length) {
      break;
    }
  }
  return result;
}
