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
    expect(cfg.marcas_pdf_path).toBeNull();
    expect(cfg.work_style).toBe("Simplex");
  });

  it("aceita grid.ocupadas com espaços em branco", () => {
    const cfg = validateImposicaoConfigObject({
      ...DEFAULT_IMPOSICAO_CONFIG,
      grid: {
        colunas: 2,
        linhas: 2,
        ocupadas: [
          { col: 0, row: 0, pagina: 2 },
          { col: 1, row: 1, pagina: 1 },
        ],
      },
    });
    expect(cfg.grid.ocupadas).toEqual([
      { col: 1, row: 1, pagina: 1 },
      { col: 0, row: 0, pagina: 2 },
    ]);
  });

  it("rejeita ocupadas fora da grade e aceita pagina repetida", () => {
    expect(() =>
      validateImposicaoConfigObject({
        ...DEFAULT_IMPOSICAO_CONFIG,
        grid: {
          colunas: 2,
          linhas: 1,
          ocupadas: [{ col: 2, row: 0, pagina: 1 }],
        },
      }),
    ).toThrow(/fora da grade/);

    const cfg = validateImposicaoConfigObject({
      ...DEFAULT_IMPOSICAO_CONFIG,
      grid: {
        colunas: 2,
        linhas: 1,
        ocupadas: [
          { col: 0, row: 0, pagina: 1 },
          { col: 1, row: 0, pagina: 1 },
        ],
      },
    });
    expect(cfg.grid.ocupadas).toEqual([
      { col: 0, row: 0, pagina: 1 },
      { col: 1, row: 0, pagina: 1 },
    ]);
  });

  it("aceita Duplex com ocupadas_verso", () => {
    const cfg = validateImposicaoConfigObject({
      ...DEFAULT_IMPOSICAO_CONFIG,
      work_style: "Duplex",
      grid: {
        colunas: 2,
        linhas: 1,
        ocupadas: [
          { col: 0, row: 0, pagina: 1 },
          { col: 1, row: 0, pagina: 1 },
        ],
        ocupadas_verso: [
          { col: 0, row: 0, pagina: 2 },
          { col: 1, row: 0, pagina: 2 },
        ],
      },
    });
    expect(cfg.work_style).toBe("Duplex");
    expect(cfg.grid.ocupadas_verso).toEqual([
      { col: 0, row: 0, pagina: 2 },
      { col: 1, row: 0, pagina: 2 },
    ]);
  });

  it("exige PDF de marcas quando marcas_corte=true", () => {
    const soft = validateImposicaoConfigObject(
      {
        ...DEFAULT_IMPOSICAO_CONFIG,
        marcas_corte: true,
        marcas_pdf_path: null,
      },
      { requireMarcasPdf: false },
    );
    expect(soft.marcas_corte).toBe(true);
    expect(soft.marcas_pdf_path).toBeNull();

    expect(() =>
      validateImposicaoConfigObject({
        ...DEFAULT_IMPOSICAO_CONFIG,
        marcas_corte: true,
        marcas_pdf_path: null,
      }),
    ).toThrow(/caminho do PDF de marcas/);

    const cfg = validateImposicaoConfigObject({
      ...DEFAULT_IMPOSICAO_CONFIG,
      marcas_corte: true,
      marcas_pdf_path:
        "\\\\redecamara\\dfsdata\\CGraf\\ImposicaoSIELT_5x2_A4.pdf",
    });
    expect(cfg.marcas_pdf_path).toContain("ImposicaoSIELT_5x2_A4.pdf");
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
