import { osRowKey } from "./osTableRows";
import type { OsSearchRow } from "./types";

type OsHomeListQuery = {
  data?: unknown;
  isPlaceholderData?: boolean;
};

/**
 * A busca completa da home guarda o resultado anterior como placeholder.
 * Esse placeholder não pode esconder a página rápida já atualizada, nem ser
 * tratado como a lista do filtro novo.
 */
export function resolveOsHomeListQuery<T extends OsHomeListQuery>(
  full: T,
  fast: T,
): { source: T; showingFastOnly: boolean; hideStalePlaceholder: boolean } {
  const fullFresh = Boolean(full.data) && !full.isPlaceholderData;
  const fastFresh = Boolean(fast.data) && !fast.isPlaceholderData;
  if (fullFresh) {
    return { source: full, showingFastOnly: false, hideStalePlaceholder: false };
  }
  if (fastFresh) {
    return { source: fast, showingFastOnly: true, hideStalePlaceholder: false };
  }
  const stale = Boolean(full.isPlaceholderData || fast.isPlaceholderData);
  return {
    source: full.data ? full : fast,
    showingFastOnly: false,
    hideStalePlaceholder: stale,
  };
}

export function lastOsSearchRow(
  rows: readonly OsSearchRow[],
): OsSearchRow | undefined {
  return rows.length > 0 ? rows[rows.length - 1] : undefined;
}

/**
 * Decide se a lista da home deve selecionar o último item (padrão dos andamentos).
 * Não troca a seleção se a OS atual ainda está no resultado (reordenar não é lista nova).
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
  if (args.selected) {
    return null;
  }
  return { select: args.lastRow, nextAutoKey: osRowKey(args.lastRow) };
}
