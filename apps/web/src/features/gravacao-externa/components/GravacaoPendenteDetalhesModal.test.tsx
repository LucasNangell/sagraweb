import { describe, expect, it } from "vitest";

import { sumCotasFromFornecedorDrafts } from "./GravacaoPendenteDetalhesModal";

describe("sumCotasFromFornecedorDrafts", () => {
  it("soma cotas F1+F2 por máquina e total geral", () => {
    const { maquinaKpis, total } = sumCotasFromFornecedorDrafts([
      {
        cotas: { Komori: "10", SM74: "5", PM52: "0" },
      },
      {
        cotas: { Komori: "20", SM74: "15", PM52: "2" },
      },
    ]);

    expect(maquinaKpis).toEqual([
      { maquina: "Komori", cota: 30 },
      { maquina: "SM74", cota: 20 },
      { maquina: "PM52", cota: 2 },
    ]);
    expect(total).toBe(52);
  });

  it("trata inválidos/vazios como 0 e não usa cota inicial", () => {
    const { maquinaKpis, total } = sumCotasFromFornecedorDrafts([
      {
        cotas: { Komori: "", SM74: "abc", PM52: "-3" },
      },
      {
        cotas: { Komori: "7", SM74: "0", PM52: "1" },
      },
    ]);

    expect(maquinaKpis.find((k) => k.maquina === "Komori")?.cota).toBe(7);
    expect(maquinaKpis.find((k) => k.maquina === "SM74")?.cota).toBe(0);
    expect(maquinaKpis.find((k) => k.maquina === "PM52")?.cota).toBe(1);
    expect(total).toBe(8);
  });
});
