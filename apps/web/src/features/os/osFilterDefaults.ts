import type { YearFilterMode } from "./types";

/** Ano corrente — seguro em browser e testes Node. */
export function getCurrentCalendarYear(): number {
  if (typeof globalThis !== "undefined" && "Date" in globalThis) {
    return new Date().getFullYear();
  }
  return 2026;
}

/** Ano padrão da home: ano corrente (multiselect específico). */
export function getDefaultYearValue(): number {
  return getCurrentCalendarYear();
}

/** Lista padrão de anos na abertura da home. */
export function getDefaultAnos(): number[] {
  return [getDefaultYearValue()];
}

/**
 * Modo legado "a partir de" — usado por CotasGraf / consumidores fora da home.
 * A home não usa mais anoMode.
 */
export function getDefaultYearMode(): YearFilterMode {
  return "from";
}

/** Ano default legada para painéis que ainda usam “a partir de” (ano anterior). */
export function getDefaultFromYearValue(): number {
  return getCurrentCalendarYear() - 1;
}

/** Ajusta ano padrão quando a lista de anos do backend não contém o preferido. */
export function resolveDefaultYear(
  preferred: number,
  availableYears: number[],
): number | undefined {
  if (availableYears.length === 0) {
    return undefined;
  }
  if (availableYears.includes(preferred)) {
    return preferred;
  }
  const eligible = availableYears.filter((y) => y <= preferred);
  if (eligible.length > 0) {
    return Math.max(...eligible);
  }
  return Math.max(...availableYears);
}
