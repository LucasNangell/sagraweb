import type { OsHistoryRow } from "./types";

/** Ordem do histórico: CodStatus A→Z (Data não entra na ordenação). */
export function sortOsHistoryRows(rows: OsHistoryRow[]): OsHistoryRow[] {
  return [...rows].sort((a, b) =>
    (a.CodStatus ?? "").localeCompare(b.CodStatus ?? "", undefined, {
      sensitivity: "base",
    }),
  );
}

/** Remove andamentos duplicados (mesmo CodStatus) e ordena por CodStatus. */
export function dedupeOsHistoryRows(rows: OsHistoryRow[]): OsHistoryRow[] {
  const seen = new Set<string>();
  const result: OsHistoryRow[] = [];
  for (const row of rows) {
    const cod = row.CodStatus?.trim();
    if (!cod || seen.has(cod)) {
      continue;
    }
    seen.add(cod);
    result.push(row);
  }
  return sortOsHistoryRows(result);
}

/** Último andamento operacional (UltimoStatus / Data mais recente). */
export function pickLatestHistoryRow(
  rows: OsHistoryRow[],
): OsHistoryRow | undefined {
  if (!rows.length) {
    return undefined;
  }
  let latest = rows[0];
  let latestTime = latest.Data ? Date.parse(latest.Data) : Number.NEGATIVE_INFINITY;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const time = row.Data ? Date.parse(row.Data) : Number.NEGATIVE_INFINITY;
    if (time >= latestTime) {
      latest = row;
      latestTime = time;
    }
  }
  return latest;
}
