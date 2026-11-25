import { describe, expect, it } from "vitest";

import {
  CAMPOS_EXTRAS_DADOS_KEY,
  alignParaCelula,
  camposExtrasParaDados,
  celulaParaAlign,
  mmParaPt,
  normalizarCamposExtras,
  novoIdCampoExtra,
  ptParaMm,
  toggleNegritoRange,
} from "./papelariaCamposExtras";

describe("papelariaCamposExtras", () => {
  it("normaliza lista válida com tipografia e posição", () => {
    const out = normalizarCamposExtras([
      {
        id: "extra_1",
        tipo: "texto",
        ancora_chave: "7:1:NOME",
        direcao: "abaixo",
        texto: "Cargo",
        align_h: "centro",
        align_v: "topo",
        tamanho_pt: 14,
        negrito: [[0, 5]],
        x_pt: 10,
        y_pt: 20,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.align_h).toBe("centro");
    expect(out[0]?.tamanho_pt).toBe(14);
    expect(out[0]?.negrito).toEqual([[0, 5]]);
    expect(out[0]?.x_pt).toBe(10);
  });

  it("ignora itens inválidos", () => {
    expect(normalizarCamposExtras([{ id: "x", tipo: "foo" }])).toEqual([]);
    expect(normalizarCamposExtras("{")).toEqual([]);
  });

  it("serializa para dados do job", () => {
    const json = camposExtrasParaDados([
      {
        id: "extra_1",
        tipo: "texto",
        ancora_chave: "7:1:NOME",
        direcao: "acima",
        texto: "Linha",
        rede_chave: "",
        rede_valor: "",
        x_pt: null,
        y_pt: null,
        offset_x_pt: 0,
        offset_y_pt: 0,
        align_h: "esquerda",
        align_v: "topo",
        tamanho_pt: null,
        negrito: [],
      },
    ]);
    expect(json).toContain("extra_1");
    expect(CAMPOS_EXTRAS_DADOS_KEY).toBe("__campos_extras");
    expect(camposExtrasParaDados([])).toBeNull();
  });

  it("gera ids únicos", () => {
    expect(novoIdCampoExtra()).not.toBe(novoIdCampoExtra());
  });

  it("converte mm ↔ pt", () => {
    expect(ptParaMm(72)).toBeCloseTo(25.4, 5);
    expect(mmParaPt(25.4)).toBeCloseTo(72, 5);
  });

  it("mapeia grade 3x3", () => {
    expect(celulaParaAlign(0, 1)).toEqual({ align_h: "centro", align_v: "topo" });
    expect(alignParaCelula("direita", "base")).toEqual({ row: 2, col: 2 });
  });

  it("toggle negrito no intervalo", () => {
    expect(toggleNegritoRange([], 0, 4, 10)).toEqual([[0, 4]]);
    expect(toggleNegritoRange([[0, 4]], 0, 4, 10)).toEqual([]);
    // Sobreposição parcial: completa o negrito no intervalo selecionado
    expect(toggleNegritoRange([[0, 4]], 2, 6, 10)).toEqual([[0, 6]]);
  });
});
