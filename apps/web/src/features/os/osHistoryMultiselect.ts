/**
 * Clique na lista de andamentos da home:
 * - sem modificador: substitui a seleção
 * - Ctrl/Meta: inclui ou remove a linha
 * - Shift: seleciona o intervalo entre a âncora e a linha clicada
 */
export type HistorySelectionMode = "replace" | "toggle" | "range";

export function resolveHistorySelectionMode(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): HistorySelectionMode {
  if (event.shiftKey) {
    return "range";
  }
  if (event.ctrlKey || event.metaKey) {
    return "toggle";
  }
  return "replace";
}

/** @deprecated Preferir resolveHistorySelectionMode. */
export function isHistorySelectionAdditive(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
}

export function nextHistorySelectionKeys(
  currentKeys: readonly string[],
  clickedKey: string,
  additive: boolean,
): string[] {
  if (!additive) {
    return [clickedKey];
  }
  if (currentKeys.includes(clickedKey)) {
    return currentKeys.filter((key) => key !== clickedKey);
  }
  return [...currentKeys, clickedKey];
}

export function rangeHistorySelectionKeys(
  allKeys: readonly string[],
  anchorKey: string | null,
  clickedKey: string,
): string[] {
  if (allKeys.length === 0) {
    return [clickedKey];
  }
  const end = allKeys.indexOf(clickedKey);
  if (end < 0) {
    return [clickedKey];
  }
  const start =
    anchorKey != null && allKeys.includes(anchorKey)
      ? allKeys.indexOf(anchorKey)
      : end;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return allKeys.slice(from, to + 1);
}

export function nextHistorySelectionRows<T>(
  current: readonly T[],
  clicked: T,
  getKey: (row: T) => string,
  mode: HistorySelectionMode,
  options?: {
    allRows?: readonly T[];
    anchorKey?: string | null;
  },
): { rows: T[]; nextAnchorKey: string } {
  const clickedKey = getKey(clicked);
  const allRows = options?.allRows ?? current;
  const anchorKey = options?.anchorKey ?? null;

  if (mode === "replace") {
    return { rows: [clicked], nextAnchorKey: clickedKey };
  }

  if (mode === "toggle") {
    const nextKeys = nextHistorySelectionKeys(
      current.map(getKey),
      clickedKey,
      true,
    );
    const byKey = new Map(current.map((row) => [getKey(row), row]));
    byKey.set(clickedKey, clicked);
    return {
      rows: nextKeys
        .map((key) => byKey.get(key))
        .filter((row): row is T => row != null),
      // Mantém a âncora para o próximo Shift (comportamento tipo Explorer).
      nextAnchorKey: anchorKey ?? clickedKey,
    };
  }

  const allKeys = allRows.map(getKey);
  const rangeKeys = rangeHistorySelectionKeys(allKeys, anchorKey, clickedKey);
  const byKey = new Map(allRows.map((row) => [getKey(row), row]));
  return {
    rows: rangeKeys
      .map((key) => byKey.get(key))
      .filter((row): row is T => row != null),
    nextAnchorKey: anchorKey ?? clickedKey,
  };
}

/** Mais novos primeiro (índice maior na lista cronológica). */
export function sortHistoryRowsNewestFirst<T>(
  selected: readonly T[],
  allRows: readonly T[],
  getKey: (row: T) => string,
): T[] {
  const index = new Map(allRows.map((row, i) => [getKey(row), i]));
  return [...selected].sort(
    (a, b) => (index.get(getKey(b)) ?? 0) - (index.get(getKey(a)) ?? 0),
  );
}
