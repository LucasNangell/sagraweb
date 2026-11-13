import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPOSICAO_CONFIG,
  parseImposicaoConfigJson,
  validateImposicaoConfigObject,
} from "./index";

describe("imposicaoConfigUtils", () => {
  it("aceita config padrão", () => {
    const cfg = validateImposicaoConfigObject(DEFAULT_IMPOSICAO_CONFIG);
    expect(cfg.folha.largura_mm).toBe(320);
    expect(cfg.grid.colunas).toBe(2);
  });

  it("parse vazio retorna null", () => {
    expect(parseImposicaoConfigJson(null)).toBeNull();
    expect(parseImposicaoConfigJson("")).toBeNull();
  });

  it("rejeita grid inválido", () => {
    expect(() =>
      validateImposicaoConfigObject({
        ...DEFAULT_IMPOSICAO_CONFIG,
        grid: { colunas: 0, linhas: 1, repeticoes: 1 },
      }),
    ).toThrow(/colunas/);
  });
});
