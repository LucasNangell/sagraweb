import { osRowKey } from "./osTableRows";
import type { OsSearchRow } from "./types";

export function lastOsSearchRow(
  rows: readonly OsSearchRow[],
): OsSearchRow | undefined {
  return rows.length > 0 ? rows[rows.length - 1] : undefined;
}

/**
 * Decide se a lista da home deve selecionar o último item (padrão dos andamentos).
 * Não sobrescreve clique do usuário enquanto o último item da mesma lista não mudar.
 */
export function shouldAutoSelectLastOsRow(args: {
  lastRow: OsSearchRow | undefined;
  selected: OsSearchRow | null;
  lastAutoKey: string | null;
  editing: boolean;
}): { select: OsSearchRow; nextAutoKey: string } | null {
  if (args.editing || !args.lastRow) {
    return null;
  }
  const key = osRowKey(args.lastRow);
  if (args.selected && args.lastAutoKey === key) {
    return null;
  }
  return { select: args.lastRow, nextAutoKey: key };
}
