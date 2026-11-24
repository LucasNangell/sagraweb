/**
 * Clique na lista de andamentos da home: sem Ctrl substitui a seleção;
 * com Ctrl (ou Meta no macOS) inclui ou remove a linha.
 */
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

export function nextHistorySelectionRows<T>(
  current: readonly T[],
  clicked: T,
  getKey: (row: T) => string,
  additive: boolean,
): T[] {
  const clickedKey = getKey(clicked);
  const nextKeys = nextHistorySelectionKeys(
    current.map(getKey),
    clickedKey,
    additive,
  );
  if (!additive) {
    return [clicked];
  }
  const byKey = new Map(current.map((row) => [getKey(row), row]));
  byKey.set(clickedKey, clicked);
  return nextKeys
    .map((key) => byKey.get(key))
    .filter((row): row is T => row != null);
}

export function isHistorySelectionAdditive(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
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
