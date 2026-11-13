import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPOSICAO_CONFIG,
  parseImposicaoConfigJson,
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
});
