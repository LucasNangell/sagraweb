import { describe, expect, it } from "vitest";

import {
  getActiveFilterLabels,
  getActiveFilterValueSummary,
  getExactOsLookupHint,
  getImplicitFilterHints,
  getTextFilterMinLengthHint,
} from "./filterStatus";
import type { OsSearchFilters } from "./types";

const base: OsSearchFilters = {
  nrOs: undefined,
  anos: [],
  produto: "",
  produtos: [],
  titulo: "",
  processo: "",
  solicitante: "",
  solicitantes: [],
  categorias: [],
  maquinas: [],
  situacao: [],
  setor: [],
  prioridade: [],
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: 20,
};

describe("getExactOsLookupHint", () => {
  it("não emite hint — lookup exato combina com filtros de escolha", () => {
    expect(
      getExactOsLookupHint({
        ...base,
        nrOs: 100,
        exactOsLookup: true,
      }),
    ).toBeNull();
  });
});

describe("getImplicitFilterHints", () => {
  it("não menciona exclusão de entregues/canceladas", () => {
    const hints = getImplicitFilterHints(base);
    expect(hints.some((h) => h.toLowerCase().includes("entregue"))).toBe(false);
  });

  it("inclui restrição de OS/SP quando desligados", () => {
    const hints = getImplicitFilterHints({
      ...base,
      includeOs: false,
      includeSp: false,
    });
    expect(hints.some((h) => h.includes("sem OS"))).toBe(true);
    expect(hints.some((h) => h.includes("sem SP"))).toBe(true);
  });
});

describe("getActiveFilterValueSummary", () => {
  it("lista valores aplicados", () => {
    const summary = getActiveFilterValueSummary({
      ...base,
      anos: [2026],
      produtos: ["Cartão"],
      solicitantes: ["João"],
    });
    expect(summary).toContain("2026");
    expect(summary).toContain("Cartão");
    expect(summary).toContain("João");
  });

  it("inclui formato, papel e intervalo de entrada", () => {
    const summary = getActiveFilterValueSummary({
      ...base,
      formatos: ["A4"],
      papel: "couché",
      dataEntradaDe: "2026-01-01",
      dataEntradaAte: "2026-02-01",
    });
    expect(summary).toContain("A4");
    expect(summary).toContain("couché");
    expect(summary).toContain("2026-01-01–2026-02-01");
  });
});

describe("getActiveFilterLabels", () => {
  it("rotula os campos avançados", () => {
    const labels = getActiveFilterLabels({
      ...base,
      formatos: ["A4"],
      observacao: "urgente",
      dataEntradaDe: "2026-01-01",
    });
    expect(labels).toContain("Formato");
    expect(labels).toContain("Observação");
    expect(labels).toContain("Data de entrada");
  });
});

describe("getTextFilterMinLengthHint", () => {
  it("pede 3 caracteres em Papel", () => {
    expect(getTextFilterMinLengthHint({ ...base, papel: "co" })).toContain(
      "Papel",
    );
  });
});
