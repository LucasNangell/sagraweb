import { describe, expect, it } from "vitest";

import {
  ajustarFcad,
  ajustarFcola,
  calcularLombadaMm,
  DIF_LOMBADA_DEFAULT,
  labelTipoAcabamento,
  lombadaSugeridaMm,
  tipoAcabamento,
} from "./lombadaCalc";

describe("lombadaCalc", () => {
  it("ajusta Fcad pelas faixas de Δ", () => {
    expect(ajustarFcad(0.5)).toBe(0.5);
    expect(ajustarFcad(1)).toBe(0.5);
    expect(ajustarFcad(1.4)).toBe(1);
    expect(ajustarFcad(2)).toBe(1);
    expect(ajustarFcad(2.1)).toBeNull();
    expect(ajustarFcad(0)).toBeNull();
  });

  it("ajusta Fcola para diferença pequena (default 1.4)", () => {
    expect(ajustarFcola(200, DIF_LOMBADA_DEFAULT)).toBe(0.5);
    expect(ajustarFcola(201, DIF_LOMBADA_DEFAULT)).toBe(1);
    expect(ajustarFcola(401, DIF_LOMBADA_DEFAULT)).toBe(2);
    expect(ajustarFcola(601, DIF_LOMBADA_DEFAULT)).toBe(3);
    expect(ajustarFcola(801, DIF_LOMBADA_DEFAULT)).toBeNull();
  });

  it("ajusta Fcola para diferença grande (> 1.4)", () => {
    expect(ajustarFcola(100, 1.5)).toBe(1);
    expect(ajustarFcola(250, 2)).toBe(2);
    expect(ajustarFcola(500, 3)).toBe(3);
    expect(ajustarFcola(700, 2)).toBe(4);
  });

  it("calcula o exemplo do relatório Access (200 / 80µm / 220µm / Δ1.4)", () => {
    const pgs = 200;
    const dif = 1.4;
    const fcad = ajustarFcad(dif)!;
    const fcola = ajustarFcola(pgs, dif)!;
    const lombada = calcularLombadaMm({
      pgs,
      mioloEspUm: 80,
      capaEspUm: 220,
      fcola,
      fcad,
    });
    expect(fcad).toBe(1);
    expect(fcola).toBe(0.5);
    expect(lombada).toBeCloseTo(9.94, 5);
    expect(lombadaSugeridaMm(lombada)).toBe(10);
    expect(tipoAcabamento(lombada)).toBe("lombada_quadrada");
    expect(labelTipoAcabamento("lombada_quadrada")).toBe("Lombada Quadrada");
  });

  it("classifica acabamento nos limiares 6 e 35 mm", () => {
    expect(tipoAcabamento(5.99)).toBe("grampo_canoa");
    expect(tipoAcabamento(6)).toBe("lombada_quadrada");
    expect(tipoAcabamento(35)).toBe("lombada_quadrada");
    expect(tipoAcabamento(35.01)).toBe("espiral");
  });
});
