import { describe, expect, it } from "vitest";

import { orcamentoOsSearch } from "./OrcamentoCotaHeaderButton";

describe("orcamentoOsSearch", () => {
  it("monta ano e id da OS para a rota de orçamento", () => {
    expect(orcamentoOsSearch("2026", "2465")).toEqual({
      ano: "2026",
      id: "2465",
    });
  });

  it("rejeita OS sem número válido", () => {
    expect(orcamentoOsSearch("", "")).toBeNull();
    expect(orcamentoOsSearch("2026", "0")).toBeNull();
  });
});
