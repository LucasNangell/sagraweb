import { describe, expect, it } from "vitest";

import {
  CAMPOS_EXTRAS_DADOS_KEY,
  alignParaCelula,
  ancoraPtDeAreaFrac,
  camposExtrasParaDados,
  celulaParaAlign,
  mmParaPt,
  normalizarCamposExtras,
  novoIdCampoExtra,
  ptParaMm,
  segmentosComNegrito,
  selecaoEstaEmNegrito,
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
        redes: [],
        estilo: null,
        icone_pt: null,
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

  it("compat legado e multi-rede com estilo/icone", () => {
    const legado = normalizarCamposExtras([
      {
        id: "extra_legado",
        tipo: "rede",
        ancora_chave: "7:1:NOME",
        direcao: "direita",
        rede_chave: "instagram",
        rede_valor: "@ana",
      },
    ]);
    expect(legado).toHaveLength(1);
    expect(legado[0]?.redes).toEqual([{ chave: "instagram", valor: "@ana" }]);
    expect(legado[0]?.estilo).toBeNull();
    expect(legado[0]?.icone_pt).toBeNull();

    const multi = normalizarCamposExtras([
      {
        id: "extra_multi",
        tipo: "rede",
        ancora_chave: "7:1:NOME",
        direcao: "abaixo",
        redes: [
          { chave: "instagram", valor: "@ana" },
          { chave: "facebook", valor: "ana.fb" },
        ],
        estilo: "pb",
        icone_pt: 18,
        tamanho_pt: 10,
      },
    ]);
    expect(multi[0]?.redes).toHaveLength(2);
    expect(multi[0]?.rede_chave).toBe("instagram");
    expect(multi[0]?.rede_valor).toBe("@ana");
    expect(multi[0]?.estilo).toBe("pb");
    expect(multi[0]?.icone_pt).toBe(18);

    const json = camposExtrasParaDados(multi);
    expect(json).toContain('"redes"');
    expect(json).toContain('"estilo":"pb"');
    expect(json).toContain('"icone_pt":18');
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

  it("ancoraPtDeAreaFrac usa o ponto 3×3, não o canto SE", () => {
    const area: [number, number, number, number] = [0.1, 0.2, 0.5, 0.4];
    expect(ancoraPtDeAreaFrac(area, 100, 200, "esquerda", "topo")).toEqual({
      x_pt: 10,
      y_pt: 40,
    });
    expect(ancoraPtDeAreaFrac(area, 100, 200, "centro", "meio")).toEqual({
      x_pt: 30,
      y_pt: 60,
    });
    expect(ancoraPtDeAreaFrac(area, 100, 200, "direita", "base")).toEqual({
      x_pt: 50,
      y_pt: 80,
    });
  });

  it("toggle negrito no intervalo", () => {
    expect(toggleNegritoRange([], 0, 4, 10)).toEqual([[0, 4]]);
    expect(toggleNegritoRange([[0, 4]], 0, 4, 10)).toEqual([]);
    // Sobreposição parcial: completa o negrito no intervalo selecionado
    expect(toggleNegritoRange([[0, 4]], 2, 6, 10)).toEqual([[0, 6]]);
  });

  it("segmentos e seleção em negrito", () => {
    expect(segmentosComNegrito("Abcde", [[1, 3]])).toEqual([
      { texto: "A", negrito: false },
      { texto: "bc", negrito: true },
      { texto: "de", negrito: false },
    ]);
    expect(selecaoEstaEmNegrito([[1, 3]], 1, 3, 5)).toBe(true);
    expect(selecaoEstaEmNegrito([[1, 3]], 0, 3, 5)).toBe(false);
    expect(selecaoEstaEmNegrito([[1, 3]], 2, 2, 5)).toBe(true);
  });
});
