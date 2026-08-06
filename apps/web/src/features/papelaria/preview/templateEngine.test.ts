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
});
