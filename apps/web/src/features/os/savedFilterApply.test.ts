import { describe, expect, it } from "vitest";

import {
  hasAnySavedFilterCriteria,
  savedFilterToOsPatch,
  userDefaultToOsPatch,
} from "./savedFilterApply";
import type { SavedFilter } from "./types";

const baseFilter: SavedFilter = {
  id: 1,
  nome: "Teste",
  situacoes: ["Em Andamento"],
  setores: ["Arte"],
  is_default: false,
  criterios: {
    nr_os: null,
    anos: [2026],
    processo: "12345",
    categorias: ["Deputado"],
    solicitantes: ["João"],
    titulo: "Obra",
    produtos: ["Cartão"],
    maquinas: ["A1"],
    prioridade: ["Normal"],
  },
};

describe("savedFilterApply", () => {
  it("aplica todos os critérios no patch", () => {
    const patch = savedFilterToOsPatch(baseFilter);
    expect(patch.anos).toEqual([2026]);
    expect(patch.processo).toBe("12.345");
    expect(patch.categorias).toEqual(["Deputado"]);
    expect(patch.solicitantes).toEqual(["João"]);
    expect(patch.titulo).toBe("Obra");
    expect(patch.produtos).toEqual(["Cartão"]);
    expect(patch.maquinas).toEqual(["A1"]);
    expect(patch.prioridade).toEqual(["Normal"]);
    expect(patch.situacao).toEqual(["Em Andamento"]);
    expect(patch.setor).toEqual(["Arte"]);
  });

  it("filtros legados sem criterios ainda aplicam situacao/setor", () => {
    const patch = savedFilterToOsPatch({
      id: 2,
      nome: "Legado",
      situacoes: ["Entregue"],
      setores: [],
      is_default: true,
    });
    expect(patch.situacao).toEqual(["Entregue"]);
    expect(patch.anos).toEqual([]);
    expect(patch.produtos).toEqual([]);
  });

  it("detecta critérios ativos", () => {
    expect(hasAnySavedFilterCriteria(baseFilter)).toBe(true);
    expect(
      hasAnySavedFilterCriteria({
        id: 3,
        nome: "Vazio",
        situacoes: [],
        setores: [],
        is_default: false,
      }),
    ).toBe(false);
  });

  it("userDefaultToOsPatch retorna null quando vazio", () => {
    expect(
      userDefaultToOsPatch({
        ponto: "1",
        situacoes: [],
        setores: [],
      }),
    ).toBeNull();
  });
});
