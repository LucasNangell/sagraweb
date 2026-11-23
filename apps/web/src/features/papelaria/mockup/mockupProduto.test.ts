import { describe, expect, it } from "vitest";

import { mockupJsonEfetivo } from "./mockupProduto";

describe("mockupJsonEfetivo", () => {
  const modelo = {
    mockup_config_json: "PRODUTO_FRENTE",
    mockup_config_json_modelo: "DO_MODELO",
    mockup_produto: { frente: "PRODUTO_FRENTE", frente_verso: "PRODUTO_FV" },
  };

  it("usa a variação do produto pela quantidade de páginas", () => {
    expect(mockupJsonEfetivo(modelo, 1)).toBe("PRODUTO_FRENTE");
    expect(mockupJsonEfetivo(modelo, 2)).toBe("PRODUTO_FV");
  });

  it("sem a variação no produto, cai no mockup do modelo (ou automático)", () => {
    const semFv = { ...modelo, mockup_produto: { frente: "PRODUTO_FRENTE", frente_verso: null } };
    expect(mockupJsonEfetivo(semFv, 2)).toBe("DO_MODELO");
    expect(mockupJsonEfetivo({ ...semFv, mockup_config_json_modelo: null }, 2)).toBeNull();
  });

  it("registro antigo (sem mockup_produto) mantém o comportamento anterior", () => {
    expect(mockupJsonEfetivo({ mockup_config_json: "X" }, 2)).toBe("X");
    expect(mockupJsonEfetivo(undefined, 1)).toBeUndefined();
  });
});
