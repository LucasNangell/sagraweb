import { describe, expect, it } from "vitest";

import { defaultOsFilters } from "./osFiltersStore";
import {
  lastOsSearchRow,
  shouldAutoSelectLastOsRow,
} from "./osHomeListSelection";
import type { OsSearchRow } from "./types";

const first: OsSearchRow = { nr_os: 1, ano: 2025 };
const last: OsSearchRow = { nr_os: 99, ano: 2026 };

describe("defaultOsFilters", () => {
  it("ordena por ano e número crescentes e pede fetchAll", () => {
    const filters = defaultOsFilters();
    expect(filters.sortBy).toBe("ano");
    expect(filters.sortDir).toBe("asc");
    expect(filters.sorts).toEqual([{ column: "ano", dir: "asc" }]);
    expect(filters.fetchAll).toBe(true);
  });
});

describe("lastOsSearchRow", () => {
  it("retorna o último item", () => {
    expect(lastOsSearchRow([first, last])).toEqual(last);
    expect(lastOsSearchRow([])).toBeUndefined();
  });
});

describe("shouldAutoSelectLastOsRow", () => {
  it("seleciona o último quando não há seleção", () => {
    const decision = shouldAutoSelectLastOsRow({
      lastRow: last,
      selected: null,
      lastAutoKey: null,
      editing: false,
    });
    expect(decision).toEqual({ select: last, nextAutoKey: "2026-99" });
  });

  it("não sobrescreve clique do usuário enquanto o último item não muda", () => {
    const decision = shouldAutoSelectLastOsRow({
      lastRow: last,
      selected: first,
      lastAutoKey: "2026-99",
      editing: false,
    });
    expect(decision).toBeNull();
  });

  it("volta ao último quando a identidade do último item muda", () => {
    const newer: OsSearchRow = { nr_os: 100, ano: 2026 };
    const decision = shouldAutoSelectLastOsRow({
      lastRow: newer,
      selected: first,
      lastAutoKey: "2026-99",
      editing: false,
    });
    expect(decision).toEqual({ select: newer, nextAutoKey: "2026-100" });
  });

  it("não seleciona durante edição de andamento", () => {
    const decision = shouldAutoSelectLastOsRow({
      lastRow: last,
      selected: null,
      lastAutoKey: null,
      editing: true,
    });
    expect(decision).toBeNull();
  });
});
