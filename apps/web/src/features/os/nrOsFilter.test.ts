import { describe, expect, it } from "vitest";

import {
  formatNrOsFilter,
  getNrOsFilterValues,
  nrOsPatchFromValues,
  parseNrOsInput,
} from "./nrOsFilter";

describe("nrOsFilter", () => {
  it("lê números separados por vírgula, ponto e vírgula ou espaço", () => {
    expect(parseNrOsInput("2244, 2250;5012 7")).toEqual([2244, 2250, 5012, 7]);
  });

  it("ignora vazios, zero e duplicatas", () => {
    expect(parseNrOsInput(" ,2244,, 0, 2244 ,")).toEqual([2244]);
    expect(parseNrOsInput("")).toEqual([]);
  });

  it("um número vira nrOs simples; vários viram nrOsList", () => {
    expect(nrOsPatchFromValues([2244])).toEqual({
      nrOs: 2244,
      nrOsList: undefined,
    });
    expect(nrOsPatchFromValues([2244, 2250])).toEqual({
      nrOs: 2244,
      nrOsList: [2244, 2250],
    });
    expect(nrOsPatchFromValues([])).toEqual({
      nrOs: undefined,
      nrOsList: undefined,
    });
  });

  it("valores ativos e texto do campo", () => {
    expect(getNrOsFilterValues({ nrOs: 2244 })).toEqual([2244]);
    expect(getNrOsFilterValues({ nrOs: 2244, nrOsList: [2244, 2250] })).toEqual([
      2244, 2250,
    ]);
    expect(formatNrOsFilter({ nrOs: 2244, nrOsList: [2244, 2250] })).toBe(
      "2244, 2250",
    );
    expect(formatNrOsFilter({})).toBe("");
  });
});
