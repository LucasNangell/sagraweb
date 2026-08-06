import { describe, expect, it } from "vitest";

import {
  EMPTY_TECH_FIELD,
  extractComponentTechDetails,
  findComponenteById,
} from "./componentTechDetails";
import type { OsComponenteRow } from "./types";

const capa: OsComponenteRow = {
  id: 10,
  nome: "Capa",
  nome_normalizado: "capa",
  ordem: 0,
  ativo: true,
  lotes: [
    {
      paginas: 4,
      maquina_link: "Offset 102",
      papel_link: "Couché 250g",
      cores_link: "4x4",
      papel_desc: "com verniz",
      cores_desc: "",
    },
  ],
};

const miolo: OsComponenteRow = {
  id: 11,
  nome: "Miolo",
  nome_normalizado: "miolo",
  ordem: 1,
  ativo: true,
  lotes: [
    {
      paginas: 120,
      maquina_link: "Rotativa",
      papel_link: "Offset 90g",
      cores_link: "1x1",
      papel_desc: "",
      cores_desc: "PB",
    },
  ],
};

describe("extractComponentTechDetails", () => {
  it("extrai campos da Capa", () => {
    const d = extractComponentTechDetails(capa);
    expect(d.maquina).toBe("Offset 102");
    expect(d.paginas).toBe("4");
    expect(d.papel).toContain("Couché 250g");
    expect(d.cores).toContain("4x4");
  });

  it("extrai campos do Miolo", () => {
    const d = extractComponentTechDetails(miolo);
    expect(d.maquina).toBe("Rotativa");
    expect(d.paginas).toBe("120");
    expect(d.papel).toContain("Offset 90g");
    expect(d.cores).toContain("1x1");
  });

  it("campo vazio exibe traço, não string vazia", () => {
    const vazio: OsComponenteRow = {
      ...capa,
      lotes: [{ paginas: 0, maquina_link: "", papel_link: "", cores_link: "" }],
    };
    const d = extractComponentTechDetails(vazio);
    expect(d.maquina).toBe(EMPTY_TECH_FIELD);
    expect(d.paginas).toBe(EMPTY_TECH_FIELD);
    expect(d.papel).toBe(EMPTY_TECH_FIELD);
    expect(d.cores).toBe(EMPTY_TECH_FIELD);
  });

  it("componente ausente retorna traços", () => {
    expect(extractComponentTechDetails(null).maquina).toBe(EMPTY_TECH_FIELD);
  });
});

describe("findComponenteById", () => {
  it("encontra pelo id mesmo após renome", () => {
    const renamed = { ...capa, nome: "Capa Dura" };
    expect(findComponenteById([renamed, miolo], 10)?.nome).toBe("Capa Dura");
  });
});
