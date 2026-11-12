import { describe, expect, it } from "vitest";

import { buildPapelariaSpFilters } from "./PapelariaSpList";

describe("buildPapelariaSpFilters", () => {
  it("filtra SPs no SEFOC pelas situações escolhidas", () => {
    const filters = buildPapelariaSpFilters(["Em Execução", "Recebido"]);
    expect(filters.setor).toEqual(["SEFOC"]);
    expect(filters.situacao).toEqual(["Em Execução", "Recebido"]);
    expect(filters.includeSp).toBe(true);
    expect(filters.includeOs).toBe(false);
    expect(filters.includeFinished).toBe(false);
    expect(filters.fetchAll).toBe(true);
  });
});
