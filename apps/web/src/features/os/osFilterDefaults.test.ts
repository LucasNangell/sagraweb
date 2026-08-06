import { describe, expect, it } from "vitest";

import {
  getDefaultAnos,
  getDefaultFromYearValue,
  getDefaultYearMode,
  getDefaultYearValue,
  resolveDefaultYear,
} from "./osFilterDefaults";

describe("osFilterDefaults", () => {
  it("home: ano padrão é o corrente", () => {
    const year = new Date().getFullYear();
    expect(getDefaultYearValue()).toBe(year);
    expect(getDefaultAnos()).toEqual([year]);
  });

  it("legado CotasGraf: a partir do ano anterior", () => {
    const year = new Date().getFullYear();
    expect(getDefaultYearMode()).toBe("from");
    expect(getDefaultFromYearValue()).toBe(year - 1);
  });

  it("resolve ano quando preferido não existe na lista", () => {
    expect(resolveDefaultYear(2025, [2026, 2024, 2023])).toBe(2024);
  });

  it("mantém preferido quando existe", () => {
    expect(resolveDefaultYear(2025, [2026, 2025, 2024])).toBe(2025);
  });

  it("retorna undefined sem anos", () => {
    expect(resolveDefaultYear(2025, [])).toBeUndefined();
  });
});
