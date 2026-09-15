import { describe, expect, it } from "vitest";

import { queryKeys } from "./query-keys";

describe("queryKeys aux/gerencia", () => {
  it("unifica lookups de gerência com aux", () => {
    expect(queryKeys.gerencia.categorias).toEqual(queryKeys.aux.categorias);
    expect(queryKeys.gerencia.maquinas).toEqual(queryKeys.aux.maquinas);
    expect(queryKeys.gerencia.papeis).toEqual(queryKeys.aux.papeis);
  });
});
