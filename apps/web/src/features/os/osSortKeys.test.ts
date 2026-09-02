import { describe, expect, it } from "vitest";

import {
  cycleOsSortKeys,
  DEFAULT_OS_SORTS,
  osSortHeaderMeta,
  resolveOsSorts,
  sanitizeOsSorts,
  sortsToFilterPatch,
} from "./osSortKeys";

describe("cycleOsSortKeys", () => {
  it("adiciona em desc, inverte para asc e remove reindexando", () => {
    const added = cycleOsSortKeys(DEFAULT_OS_SORTS, "nr_os");
    expect(added).toEqual([
      { column: "ano", dir: "asc" },
      { column: "nr_os", dir: "desc" },
    ]);

    const flipped = cycleOsSortKeys(added, "nr_os");
    expect(flipped).toEqual([
      { column: "ano", dir: "asc" },
      { column: "nr_os", dir: "asc" },
    ]);

    const removed = cycleOsSortKeys(flipped, "ano");
    expect(removed).toEqual([{ column: "nr_os", dir: "asc" }]);
  });

  it("coluna nova entra no fim em desc", () => {
    expect(cycleOsSortKeys([], "ano")).toEqual([{ column: "ano", dir: "desc" }]);
  });
});

describe("osSortHeaderMeta", () => {
  it("mostra badge 1º/2º e direção da fila", () => {
    const sorts = [
      { column: "ano" as const, dir: "desc" as const },
      { column: "nr_os" as const, dir: "asc" as const },
    ];
    expect(osSortHeaderMeta(sorts, "ano")).toEqual({ dir: "desc", badge: "1º" });
    expect(osSortHeaderMeta(sorts, "nr_os")).toEqual({ dir: "asc", badge: "2º" });
    expect(osSortHeaderMeta(sorts, "produto")).toEqual({});
  });
});

describe("resolveOsSorts / sanitize", () => {
  it("usa sorts quando existe e cai no par legado", () => {
    expect(
      resolveOsSorts({
        sorts: [{ column: "ano", dir: "desc" }],
      }),
    ).toEqual([{ column: "ano", dir: "desc" }]);
    expect(resolveOsSorts({ sortBy: "nr_os", sortDir: "desc" })).toEqual([
      { column: "nr_os", dir: "desc" },
    ]);
    expect(resolveOsSorts({})).toEqual(DEFAULT_OS_SORTS);
  });

  it("espelha o primeiro item no patch de filtros", () => {
    expect(
      sortsToFilterPatch([
        { column: "ano", dir: "desc" },
        { column: "nr_os", dir: "asc" },
      ]),
    ).toEqual({
      sorts: [
        { column: "ano", dir: "desc" },
        { column: "nr_os", dir: "asc" },
      ],
      sortBy: "ano",
      sortDir: "desc",
    });
  });

  it("descarta chaves inválidas na restauração", () => {
    expect(
      sanitizeOsSorts([
        { column: "ano", dir: "desc" },
        { column: "nope", dir: "asc" },
        { column: "ano", dir: "asc" },
      ]),
    ).toEqual([{ column: "ano", dir: "desc" }]);
  });
});
