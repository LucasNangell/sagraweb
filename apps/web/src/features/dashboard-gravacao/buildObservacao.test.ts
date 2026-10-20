import { describe, expect, it } from "vitest";

import { buildGravacaoObservacao, fornecedorSessionLabel } from "./buildObservacao";

describe("buildGravacaoObservacao", () => {
  it("monta bloco de um fornecedor", () => {
    const text = buildGravacaoObservacao([
      {
        fornecedorLabel: "Alfa Birô",
        chapas: [
          { maquina: "Komori", quantidade: 3 },
          { maquina: "SM74", quantidade: 2 },
        ],
      },
    ]);
    expect(text).toContain("[Fornecedor: Alfa Birô]");
    expect(text).toContain("Chapas por máquina:");
    expect(text).toContain("- Komori: 3");
    expect(text).toContain("- SM74: 2");
  });

  it("concatena blocos de todos os fornecedores", () => {
    const text = buildGravacaoObservacao([
      {
        fornecedorLabel: "Alfa",
        chapas: [{ maquina: "Komori", quantidade: 3 }],
      },
      {
        fornecedorLabel: "Zeta",
        chapas: [{ maquina: "PM52", quantidade: 1 }],
      },
    ]);
    expect(text).toContain("[Fornecedor: Alfa]");
    expect(text).toContain("[Fornecedor: Zeta]");
    expect(text).toContain("- Komori: 3");
    expect(text).toContain("- PM52: 1");
  });

  it("usa quantidade editada", () => {
    const text = buildGravacaoObservacao([
      {
        fornecedorLabel: "Alfa",
        chapas: [{ maquina: "Komori", quantidade: 1 }],
      },
    ]);
    expect(text).toContain("- Komori: 1");
    expect(text).not.toContain(": 3");
  });

  it("informa ausência de chapas", () => {
    const text = buildGravacaoObservacao([{ chapas: [] }]);
    expect(text).toContain("- (não informado)");
    expect(text).not.toContain("[Fornecedor:");
  });
});

describe("fornecedorSessionLabel", () => {
  it("prefere o nome", () => {
    expect(
      fornecedorSessionLabel({ fornecedor_nome: "Alfa", fornecedor_ponto: "111" }),
    ).toBe("Alfa");
  });

  it("cai no ponto sem nome", () => {
    expect(fornecedorSessionLabel({ fornecedor_ponto: "111" })).toBe("111");
  });
});
