import { describe, expect, it } from "vitest";

import { applyPreviewTemplate } from "./templateEngine";

describe("applyPreviewTemplate", () => {
  it("substitui variáveis simples e compostas", () => {
    const out = applyPreviewTemplate("{partido}/{uf}", {
      partido: "PT",
      uf: "DF",
    });
    expect(out).toBe("PT/DF");
  });

  it("atualiza nome longo e curto no mesmo template", () => {
    const tpl = "{nome_deputado}";
    expect(
      applyPreviewTemplate(tpl, { nome_deputado: "Ana" }),
    ).toBe("Ana");
    expect(
      applyPreviewTemplate(tpl, {
        nome_deputado: "Maria da Silva Santos Oliveira",
      }),
    ).toBe("Maria da Silva Santos Oliveira");
  });

  it("deriva artigo e genero_curto a partir de genero", () => {
    const tpl = "Gabinete {artigo} {genero_curto} {nome_deputado}";
    expect(
      applyPreviewTemplate(tpl, {
        genero: "Deputado Federal",
        nome_deputado: "João",
      }),
    ).toBe("Gabinete do Deputado João");
    expect(
      applyPreviewTemplate(tpl, {
        genero: "Deputada Federal",
        nome_deputado: "Maria",
      }),
    ).toBe("Gabinete da Deputada Maria");
    expect(
      applyPreviewTemplate(tpl, { nome_deputado: "João" }),
    ).toBe("Gabinete do Deputado João");
    expect(
      applyPreviewTemplate(tpl, {
        genero: "Deputada Federal",
        artigo: "do",
        genero_curto: "Deputado",
        nome_deputado: "Maria",
      }),
    ).toBe("Gabinete da Deputada Maria");
  });
});
