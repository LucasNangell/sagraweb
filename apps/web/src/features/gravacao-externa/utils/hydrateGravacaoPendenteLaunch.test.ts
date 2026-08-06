import { describe, expect, it } from "vitest";

import { hydrateGravacaoPendenteLaunch } from "./hydrateGravacaoPendenteLaunch";

describe("hydrateGravacaoPendenteLaunch", () => {
  it("agrupa TIFs e PDFs por máquina", () => {
    const result = hydrateGravacaoPendenteLaunch(
      [
        { absolute_path: "\\\\srv\\a.tif", nome: "a.tif", maquina: "M1" },
        { absolute_path: "\\\\srv\\b.tif", nome: "b.tif", maquina: "M1" },
        { absolute_path: "\\\\srv\\c.tif", nome: "c.tif", maquina: "M2" },
        { absolute_path: "\\\\srv\\espelho-m1.pdf", nome: "espelho-m1.pdf", maquina: "M1" },
        { absolute_path: "\\\\srv\\espelho-m2.pdf", nome: "espelho-m2.pdf", maquina: "M2" },
      ],
      [
        { maquina: "M1", quantidade: 4 },
        { maquina: "M2", quantidade: 1 },
      ],
    );

    expect(result.chapas).toHaveLength(2);
    expect(result.chapas[0]).toMatchObject({
      maquina: "M1",
      quantidade: "4",
    });
    expect(result.chapas[0].arquivos).toHaveLength(2);
    expect(result.chapas[0].espelhosPdf).toHaveLength(1);
    expect(result.chapas[0].espelhosPdf[0].nome).toBe("espelho-m1.pdf");
    expect(result.chapas[1]).toMatchObject({
      maquina: "M2",
      quantidade: "1",
    });
    expect(result.chapas[1].arquivos).toHaveLength(1);
    expect(result.chapas[1].espelhosPdf).toHaveLength(1);
    expect(result.chapas[1].espelhosPdf[0].nome).toBe("espelho-m2.pdf");
  });

  it("anexa PDFs legados sem máquina à primeira linha", () => {
    const result = hydrateGravacaoPendenteLaunch(
      [
        { absolute_path: "\\\\srv\\a.tif", nome: "a.tif", maquina: "M1" },
        { absolute_path: "\\\\srv\\espelho.pdf", nome: "espelho.pdf", maquina: null },
      ],
      [{ maquina: "M1", quantidade: 1 }],
    );

    expect(result.chapas).toHaveLength(1);
    expect(result.chapas[0].espelhosPdf).toHaveLength(1);
    expect(result.chapas[0].espelhosPdf[0].nome).toBe("espelho.pdf");
  });

  it("cria linha só com PDF quando máquina tem apenas espelho", () => {
    const result = hydrateGravacaoPendenteLaunch(
      [{ absolute_path: "\\\\srv\\espelho.pdf", nome: "espelho.pdf", maquina: "Gravadora" }],
      [],
    );

    expect(result.chapas).toHaveLength(1);
    expect(result.chapas[0].maquina).toBe("Gravadora");
    expect(result.chapas[0].arquivos).toHaveLength(0);
    expect(result.chapas[0].espelhosPdf).toHaveLength(1);
  });

  it("cria linha vazia quando não há dados", () => {
    const result = hydrateGravacaoPendenteLaunch([], []);
    expect(result.chapas).toHaveLength(1);
    expect(result.chapas[0].maquina).toBe("");
    expect(result.chapas[0].arquivos).toHaveLength(0);
    expect(result.chapas[0].espelhosPdf).toHaveLength(0);
  });

  it("deriva quantidade pelo nº de TIFs quando chapas não informadas", () => {
    const result = hydrateGravacaoPendenteLaunch(
      [
        { absolute_path: "\\\\srv\\a.tif", nome: "a.tif", maquina: "Gravadora" },
        { absolute_path: "\\\\srv\\b.tif", nome: "b.tif", maquina: "Gravadora" },
      ],
      [],
    );
    expect(result.chapas).toHaveLength(1);
    expect(result.chapas[0].maquina).toBe("Gravadora");
    expect(result.chapas[0].quantidade).toBe("2");
  });
});
