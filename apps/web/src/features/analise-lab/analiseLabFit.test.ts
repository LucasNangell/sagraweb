import { describe, expect, it } from "vitest";

import {
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
} from "./analiseLabFit";

describe("analiseLabFit", () => {
  it("fits by width when taller aspect", () => {
    const z = fitZoom(
      { width: 800, height: 1200 },
      { width: 400, height: 900 },
    );
    expect(z).toBeLessThan(1);
    expect(z).toBeGreaterThan(0.2);
  });

  it("fits by height when wider aspect", () => {
    const z = fitZoom(
      { width: 1200, height: 400 },
      { width: 900, height: 300 },
    );
    expect(z).toBeLessThan(1);
  });

  it("builds simple rows one page each", () => {
    const rows = buildSpreadRows([1, 2, 3, 4], "simples");
    expect(rows).toEqual([[1], [2], [3], [4]]);
  });

  it("builds duplex rows with first page alone", () => {
    expect(buildSpreadRows([1, 2, 3, 4, 5], "dupla")).toEqual([
      [1],
      [2, 3],
      [4, 5],
    ]);
    expect(buildSpreadRows([1, 2, 3, 4], "dupla")).toEqual([
      [1],
      [2, 3],
      [4],
    ]);
  });

  it("finds row for page", () => {
    const rows = buildSpreadRows(
      [{ page: 1 }, { page: 2 }, { page: 3 }],
      "dupla",
    );
    expect(findRowIndexForPage(rows, 1)).toBe(0);
    expect(findRowIndexForPage(rows, 3)).toBe(1);
  });
});
