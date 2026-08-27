import { describe, expect, it } from "vitest";

import { findFormatoForDimensions, resolveFormatoDimensions } from "./formatoDimensions";
import { createEmptyGerenciaForm } from "./defaults";
import type { GerenciaFormState } from "./types";
import {
  calculateCoefA4,
  formatCoefA4Display,
  formatCotaEstimada,
  getGerenciaCotaPaginas,
  isDeputadoOsQuotaRule,
  parseCoefA4Value,
  parseCotaEstimadaValue,
  patchFormatoDimensions,
  patchFormatoFromDimensions,
  recalculateGerenciaCalcs,
  resolveGerenciaCoefA4,
  roundCoefA4,
  setGerenciaCoefA4PorProduto,
  toCheck,
  validateEntregaDataForSave,
} from "./utils";

describe("validateEntregaDataForSave", () => {
  it("não exige data quando a prioridade é Normal", () => {
    expect(
      validateEntregaDataForSave({ val_prioridade: "Normal", val_data: "" }),
    ).toBeNull();
  });

  it("bloqueia salvamento sem data quando a prioridade não é Normal", () => {
    expect(
      validateEntregaDataForSave({
        val_prioridade: "Solicitado p/",
        val_data: "",
      }),
    ).toBe("Informe a Data Entrega.");
    expect(
      validateEntregaDataForSave({
        val_prioridade: "Prometido p/",
        val_data: "  ",
      }),
    ).toBe("Informe a Data Entrega.");
  });

  it("aceita data preenchida com prioridade diferente de Normal", () => {
    expect(
      validateEntregaDataForSave({
        val_prioridade: "Solicitado p/",
        val_data: "2026-08-28",
      }),
    ).toBeNull();
  });
});

describe("toCheck", () => {
  it("interpreta 0/1 e booleanos corretamente (FrenteVerso da OS)", () => {
    expect(toCheck(0)).toBe(false);
    expect(toCheck(1)).toBe(true);
    expect(toCheck(false)).toBe(false);
    expect(toCheck(true)).toBe(true);
    expect(toCheck(null)).toBe(false);
    expect(toCheck(undefined)).toBe(false);
  });

  it("não trata string '0' como marcada (Boolean('0') seria true)", () => {
    expect(toCheck("0")).toBe(false);
    expect(toCheck("1")).toBe(true);
    expect(toCheck("false")).toBe(false);
    expect(toCheck("true")).toBe(true);
    expect(toCheck("\u0000")).toBe(false);
  });
});

function baseForm(
  patch: Partial<GerenciaFormState> = {},
): Pick<
  GerenciaFormState,
  | "req_categoria"
  | "op_os"
  | "val_pgs"
  | "calc_capa_color"
  | "calc_capa_pb"
  | "calc_miolo_color"
  | "calc_miolo_pb"
  | "calc_encarte_color"
  | "calc_encarte_pb"
  | "calc_tiragem"
  | "calc_altura"
  | "calc_largura"
  | "val_cores"
  | "txt_cores_desc"
  | "val_cores_capa1"
  | "val_cores_capa2"
  | "val_cores_mio"
  | "val_cores_mio2"
> {
  return {
    req_categoria: "Deputado",
    op_os: "1234",
    val_produto: "",
    val_pgs: "1",
    calc_capa_color: "",
    calc_capa_pb: "",
    calc_miolo_color: "",
    calc_miolo_pb: "",
    calc_encarte_color: "",
    calc_encarte_pb: "",
    calc_tiragem: "100",
    calc_altura: "210",
    calc_largura: "297",
    val_cores: "4x4",
    txt_cores_desc: "",
    val_cores_capa1: "",
    val_cores_capa2: "",
    val_cores_mio: "",
    val_cores_mio2: "",
    ...patch,
  };
}

describe("isDeputadoOsQuotaRule", () => {
  it("aplica só para Deputado com OS reprográfica (<5000)", () => {
    expect(
      isDeputadoOsQuotaRule({ req_categoria: "Deputado", op_os: "1234" }),
    ).toBe(true);
    expect(
      isDeputadoOsQuotaRule({ req_categoria: "DEPUTADO", op_os: "1234" }),
    ).toBe(true);
    expect(
      isDeputadoOsQuotaRule({ req_categoria: "Orgao", op_os: "1234" }),
    ).toBe(false);
    expect(
      isDeputadoOsQuotaRule({ req_categoria: "Deputado", op_os: "5000" }),
    ).toBe(false);
    expect(
      isDeputadoOsQuotaRule({ req_categoria: "Deputado", op_os: "6000" }),
    ).toBe(false);
  });
});

describe("getGerenciaCotaPaginas", () => {
  it("panfleto A4 só frente em policromia consome 4 páginas de cota", () => {
    expect(getGerenciaCotaPaginas(baseForm())).toBe(4);
  });

  it("panfleto P/B não multiplica páginas", () => {
    expect(
      getGerenciaCotaPaginas(
        baseForm({ val_cores: "P/B", calc_miolo_pb: "1" }),
      ),
    ).toBe(1);
  });

  it("policromia classificada nos cálculos multiplica por 4", () => {
    expect(
      getGerenciaCotaPaginas(
        baseForm({ val_cores: "", calc_miolo_color: "1", val_pgs: "1" }),
      ),
    ).toBe(4);
  });

  it("não aplica regra para Órgão nem papelaria", () => {
    expect(
      getGerenciaCotaPaginas(
        baseForm({ req_categoria: "Orgao", calc_miolo_color: "1" }),
      ),
    ).toBe(1);
    expect(
      getGerenciaCotaPaginas(
        baseForm({ op_os: "5001", calc_miolo_color: "1" }),
      ),
    ).toBe(1);
  });

  it("capa 4p com verso em branco conta 2 páginas na cota", () => {
    const spec = {
      version: 1 as const,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA" as const,
          verso_em_branco: true,
          lotes: [
            {
              id: "c",
              paginas: 4,
              maquina_link: "",
              papel_link: "",
              cores_link: "4x4",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [],
            },
          ],
        },
      ],
    };
    expect(
      getGerenciaCotaPaginas(
        baseForm({ val_pgs: "4", calc_capa_color: "2" }),
        { techSpec: spec },
      ),
    ).toBe(8);
    expect(
      getGerenciaCotaPaginas(
        baseForm({
          req_categoria: "Orgao",
          val_pgs: "4",
          calc_capa_color: "2",
        }),
        { techSpec: spec },
      ),
    ).toBe(2);
    expect(
      recalculateGerenciaCalcs(
        baseForm({
          val_pgs: "4",
          calc_capa_color: "2",
          calc_tiragem: "100",
          calc_altura: "210",
          calc_largura: "297",
        }),
        { techSpec: spec },
      ).calc_cota_total,
    ).toBe("800");
  });
});

describe("formatCoefA4Display", () => {
  it("arredonda para 1 casa decimal com separador pt-BR", () => {
    expect(formatCoefA4Display(2.007)).toBe("2,0");
    expect(formatCoefA4Display(10)).toBe("10,0");
    expect(formatCoefA4Display(1.24)).toBe("1,2");
    expect(formatCoefA4Display(1.25)).toBe("1,3");
  });

  it("parseCoefA4Value interpreta formato pt-BR", () => {
    expect(parseCoefA4Value("2,0")).toBe(2);
    expect(parseCoefA4Value("1.234,5")).toBe(1234.5);
  });
});

describe("formatCotaEstimada", () => {
  it("formata com separador de milhar pt-BR", () => {
    expect(formatCotaEstimada(1189)).toBe("1.189");
    expect(formatCotaEstimada(400)).toBe("400");
  });

  it("parseCotaEstimadaValue remove separadores ao salvar", () => {
    expect(parseCotaEstimadaValue("1.189")).toBe(1189);
    expect(parseCotaEstimadaValue("400")).toBe(400);
  });
});

describe("recalculateGerenciaCalcs", () => {
  it("cota estimada = páginas efetivas × tiragem / coef A4", () => {
    const result = recalculateGerenciaCalcs(baseForm());
    expect(result.calc_cota_total).toBe("400");
    expect(result.calc_total_paginas).toBe("1");
  });

  it("cota estimada arredonda para cima sem decimais", () => {
    const result = recalculateGerenciaCalcs(
      baseForm({
        calc_tiragem: "100",
        calc_altura: "148",
        calc_largura: "210",
      }),
    );
    expect(result.calc_cota_total).toBe("200");
  });

  it("cota estimada usa coeficiente A4 arredondado (1 casa decimal)", () => {
    const result = recalculateGerenciaCalcs(
      baseForm({
        req_categoria: "Orgao",
        val_cores: "P/B",
        calc_miolo_pb: "1",
        val_pgs: "1",
        calc_tiragem: "593",
        calc_altura: "148",
        calc_largura: "210",
      }),
    );
    expect(result.calc_coef_a4).toBe("2,0");
    expect(result.calc_cota_total).toBe("297");
  });

  it("produto de papelaria usa coeficiente da tabela independente do nº da OS", () => {
    setGerenciaCoefA4PorProduto({ "Ct Visita": 10 });
    const result = recalculateGerenciaCalcs(
      baseForm({
        op_os: "1234",
        val_produto: "Ct Visita",
        val_cores: "P/B",
        calc_miolo_pb: "1",
        calc_tiragem: "1000",
        calc_altura: "90",
        calc_largura: "50",
      }),
    );
    expect(result.calc_coef_a4).toBe("10,0");
    expect(result.calc_cota_total).toBe("100");
    setGerenciaCoefA4PorProduto({});
  });
});

describe("resolveGerenciaCoefA4", () => {
  it("mantém cálculo por dimensões para produto fora da tabela", () => {
    expect(
      resolveGerenciaCoefA4(
        baseForm({ calc_altura: "210", calc_largura: "297" }),
      ),
    ).toBeCloseTo(1, 5);
  });

  it("usa tabela pelo produto, sem depender do nº da OS", () => {
    const coef = resolveGerenciaCoefA4(
      baseForm({
        op_os: "1234",
        val_produto: "Timbrado A4",
        calc_altura: "90",
        calc_largura: "50",
      }),
      { "Timbrado A4": 1 },
    );
    expect(coef).toBe(1);
  });
});

describe("formato com unidade no nome → coeficiente A4", () => {
  function coefFromFormato(formato: string): number {
    const dims = resolveFormatoDimensions(formato);
    expect(dims).not.toBeNull();
    return roundCoefA4(calculateCoefA4(dims!.altura, dims!.largura));
  }

  it('parseia "50mmx50mm" e calcula coef ≈ 24,9', () => {
    expect(resolveFormatoDimensions("50mmx50mm")).toEqual({
      altura: 50,
      largura: 50,
    });
    expect(coefFromFormato("50mmx50mm")).toBe(24.9);
    expect(formatCoefA4Display(coefFromFormato("50mmx50mm"))).toBe("24,9");
  });

  it('parseia "50MM×50MM" e calcula coef ≈ 24,9', () => {
    expect(resolveFormatoDimensions("50MM×50MM")).toEqual({
      altura: 50,
      largura: 50,
    });
    expect(coefFromFormato("50MM×50MM")).toBe(24.9);
  });

  it('parseia "210mm x 297mm" como A4 (coef = 1,0)', () => {
    expect(resolveFormatoDimensions("210mm x 297mm")).toEqual({
      altura: 210,
      largura: 297,
    });
    expect(coefFromFormato("210mm x 297mm")).toBe(1);
  });

  it('mantém parse sem unidade ("50x50") e ISO ("A4")', () => {
    expect(resolveFormatoDimensions("50x50")).toEqual({
      altura: 50,
      largura: 50,
    });
    expect(resolveFormatoDimensions("A4")).toEqual({
      altura: 210,
      largura: 297,
    });
  });
});

describe("findFormatoForDimensions", () => {
  it("casa medidas com o nome ISO ou do catálogo", () => {
    expect(findFormatoForDimensions(210, 297)).toBe("A4");
    expect(findFormatoForDimensions(297, 210)).toBe("A4 Paisagem");
    expect(
      findFormatoForDimensions(90, 50, [
        { formato: "Cartão", altura_mm: 90, largura_mm: 50 },
      ]),
    ).toBe("Cartão");
  });

  it("preserva o nome atual quando as medidas já correspondem", () => {
    expect(
      findFormatoForDimensions(210, 297, undefined, "210mm x 297mm"),
    ).toBe("210mm x 297mm");
  });

  it("gera rótulo H x L quando não há formato cadastrado", () => {
    expect(findFormatoForDimensions(91, 52)).toBe("91 x 52");
  });
});

describe("patchFormatoFromDimensions", () => {
  it("atualiza Formato ao editar altura/largura", () => {
    const prev = {
      ...createEmptyGerenciaForm(),
      val_formato: "A4",
      calc_altura: "210",
      calc_largura: "297",
    };
    expect(
      patchFormatoFromDimensions(prev, { calc_altura: "148", calc_largura: "210" }),
    ).toEqual({
      calc_altura: "148",
      calc_largura: "210",
      val_formato: "A5",
    });
    expect(patchFormatoDimensions(prev, "A5").calc_altura).toBe("148");
    expect(patchFormatoDimensions(prev, "A5").calc_largura).toBe("210");
  });
});
