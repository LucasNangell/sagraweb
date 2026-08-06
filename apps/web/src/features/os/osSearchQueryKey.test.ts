import { describe, expect, it } from "vitest";

import {
  osSearchQueryKey,
  serializeOsSearchFilters,
} from "./osSearchQueryKey";
import { normalizeOsSearchFilters } from "./osSearchUtils";
import type { OsSearchFilters } from "./types";

const baseFilters: OsSearchFilters = {
  nrOs: undefined,
  anos: [2026],
  produto: "",
  produtos: [],
  titulo: "",
  processo: "",
  solicitante: "",
  solicitantes: [],
  categorias: [],
  maquinas: [],
  situacao: ["Em Andamento"],
  setor: ["Arte"],
  prioridade: [],
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: 50,
};

describe("osSearchQueryKey", () => {
  it("produz a mesma chave para objetos equivalentes", () => {
    const a = osSearchQueryKey(baseFilters);
    const b = osSearchQueryKey({
      ...baseFilters,
      situacao: ["Em Andamento"],
      setor: ["Arte"],
    });
    expect(a).toEqual(b);
  });

  it("diferencia filtros distintos", () => {
    const a = osSearchQueryKey(baseFilters);
    const b = osSearchQueryKey({
      ...baseFilters,
      situacao: ["Entregue"],
    });
    expect(a).not.toEqual(b);
  });

  it("serializa via normalizeOsSearchFilters", () => {
    const filters = {
      ...baseFilters,
      situacao: ["B", "A"],
      setor: ["Z", "Arte"],
    };
    expect(serializeOsSearchFilters(filters)).toBe(
      JSON.stringify(normalizeOsSearchFilters(filters)),
    );
  });
});
