import { describe, expect, it } from "vitest";

import {
  buildOsHomeSearchFilters,
  isExactOsLookup,
  normalizeOsSearchFilters,
} from "./osSearchUtils";
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
  situacao: ["Em Execução"],
  setor: ["SEFOC"],
  prioridade: ["Normal"],
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 2,
  limit: 20,
};

describe("isExactOsLookup", () => {
  it("retorna true quando nrOs está definido", () => {
    expect(isExactOsLookup({ nrOs: 2244 })).toBe(true);
  });

  it("retorna false sem nrOs", () => {
    expect(isExactOsLookup({ nrOs: undefined })).toBe(false);
  });
});

describe("buildOsHomeSearchFilters", () => {
  it("ativa exactOsLookup e reseta página quando nrOs informado", () => {
    const result = buildOsHomeSearchFilters(
      { ...baseFilters, page: 3 },
      { nrOs: 2244, titulo: "", processo: "" },
    );
    expect(result.exactOsLookup).toBe(true);
    expect(result.page).toBe(1);
    expect(result.nrOs).toBe(2244);
    expect(result.situacao).toEqual(["Em Execução"]);
    expect(result.includeFinished).toBe(true);
  });

  it("força includeFinished mesmo quando o store tinha false", () => {
    const result = buildOsHomeSearchFilters(
      { ...baseFilters, includeFinished: false },
      { nrOs: undefined, titulo: "", processo: "" },
    );
    expect(result.includeFinished).toBe(true);
  });

  it("não ativa exactOsLookup sem nrOs", () => {
    const result = buildOsHomeSearchFilters(baseFilters, {
      nrOs: undefined,
      titulo: "",
      processo: "",
    });
    expect(result.exactOsLookup).toBe(false);
    expect(result.page).toBe(2);
  });

  it("ignora título com menos de 3 caracteres sem âncora", () => {
    const result = buildOsHomeSearchFilters(baseFilters, {
      nrOs: undefined,
      titulo: "x",
      processo: "",
    });
    expect(result.titulo).toBe("");
  });

  it("ignora título curto mesmo com anos preenchidos", () => {
    const result = buildOsHomeSearchFilters(
      { ...baseFilters, anos: [2025] },
      { nrOs: undefined, titulo: "ab", processo: "" },
    );
    expect(result.titulo).toBe("");
  });

  it("permite título curto quando nrOs é âncora", () => {
    const result = buildOsHomeSearchFilters(baseFilters, {
      nrOs: 10,
      titulo: "ab",
      processo: "",
    });
    expect(result.titulo).toBe("ab");
  });

  it("ignora processo com menos de 2 dígitos", () => {
    const result = buildOsHomeSearchFilters(baseFilters, {
      nrOs: undefined,
      titulo: "",
      processo: "1",
    });
    expect(result.processo).toBe("");
  });

  it("aceita processo a partir de 2 dígitos e envia limpo", () => {
    const result = buildOsHomeSearchFilters(baseFilters, {
      nrOs: undefined,
      titulo: "",
      processo: "12.3",
    });
    expect(result.processo).toBe("123");
  });
});

describe("normalizeOsSearchFilters", () => {
  it("preserva exactOsLookup e ordena anos", () => {
    const normalized = normalizeOsSearchFilters({
      ...baseFilters,
      anos: [2026, 2024],
      exactOsLookup: true,
    });
    expect(normalized.exactOsLookup).toBe(true);
    expect(normalized.anos).toEqual([2024, 2026]);
  });

  it("normaliza processo para dígitos", () => {
    const normalized = normalizeOsSearchFilters({
      ...baseFilters,
      processo: "12.345.678/9012",
    });
    expect(normalized.processo).toBe("123456789012");
  });
});
