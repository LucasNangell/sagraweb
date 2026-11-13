import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPOSICAO_CONFIG,
  formatImposicaoVariantsJson,
  parseImposicaoConfigJson,
  parseImposicaoVariantsJson,
  validateImposicaoConfigObject,
} from "./index";

describe("imposicaoConfigUtils (JDF)", () => {
  it("aceita exemplo A5 2x1", () => {
    const cfg = validateImposicaoConfigObject(DEFAULT_IMPOSICAO_CONFIG);
    expect(cfg.folha_mm.largura).toBe(297);
    expect(cfg.pagina.origem).toBe("fixixa");
    expect(cfg.grid).toEqual({ colunas: 2, linhas: 1 });
    expect(cfg.marcas_corte).toBe(false);
    expect(cfg.work_style).toBe("Simplex");
  });

  it("parse vazio retorna null", () => {
    expect(parseImposicaoConfigJson(null)).toBeNull();
    expect(parseImposicaoConfigJson("")).toBeNull();
  });

  it("aceita origem borda sem mm", () => {
    const cfg = validateImposicaoConfigObject({
      ...DEFAULT_IMPOSICAO_CONFIG,
      pagina: { origem: "borda" },
    });
    expect(cfg.pagina).toEqual({ origem: "borda" });
  });

  it("rejeita fixixa sem tamanho", () => {
    expect(() =>
      validateImposicaoConfigObject({
        ...DEFAULT_IMPOSICAO_CONFIG,
        pagina: { origem: "fixixa" },
      }),
    ).toThrow(/largura_mm/);
  });

  it("parse envelope digital/offset e legado único", () => {
    const envelope = parseImposicaoVariantsJson(
      JSON.stringify({ digital: DEFAULT_IMPOSICAO_CONFIG, offset: null }),
    );
    expect(envelope.digital?.grid.colunas).toBe(2);
    expect(envelope.offset).toBeNull();

    const legado = parseImposicaoVariantsJson(
      JSON.stringify(DEFAULT_IMPOSICAO_CONFIG),
    );
    expect(legado.digital).toEqual(legado.offset);

    expect(
      formatImposicaoVariantsJson({ digital: null, offset: null }),
    ).toBeNull();
  });
});
