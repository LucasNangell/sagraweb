import { describe, expect, it } from "vitest";

import {
  aplicarBolsoPadrao,
  BOLSO_PASTA_AVULSO,
  encaixarCartao,
  produtoTemBolso,
  resolverBolso,
} from "./bolsoInterno";
import { getPapelariaMockupConfig } from "./getPapelariaMockupConfig";
import type { PapelariaMockupConfig } from "./types";

/** Mockup salvo hoje para as pastas avulso (capa abre sobre o interior). */
const PASTA: PapelariaMockupConfig = {
  id: "cartao_duplo_retrato_lateral",
  nome: "Pasta",
  modo: "cartao_dobrado",
  larguraAbertaMm: 220,
  alturaAbertaMm: 310,
  orientacao: "retrato",
  faces: [
    { id: "interior", nome: "Interior", pageIndex: 1, className: "mockup-face--back", style3d: {}, zIndex: 1 },
    { id: "capa", nome: "Capa", pageIndex: 0, className: "mockup-face--front", style3d: {}, zIndex: 2, abreComDobra: true },
  ],
};

describe("produtoTemBolso", () => {
  it("reconhece pasta com bolso e ignora sem bolso", () => {
    expect(produtoTemBolso("Pasta Avulso c/ Bolso")).toBe(true);
    expect(produtoTemBolso("pasta com bolso")).toBe(true);
    expect(produtoTemBolso("Pasta Avulso s/ Bolso")).toBe(false);
    expect(produtoTemBolso("Pasta sem bolso")).toBe(false);
    expect(produtoTemBolso("Ct Visita")).toBe(false);
    expect(produtoTemBolso(null)).toBe(false);
  });
});

describe("aplicarBolsoPadrao", () => {
  it("pasta c/ bolso: bolso padrão na face interna (não na capa)", () => {
    const r = aplicarBolsoPadrao(PASTA, "Pasta Avulso c/ Bolso");
    expect(r.faces.find((f) => f.id === "interior")?.bolso).toBe("pasta_avulso");
    expect(r.faces.find((f) => f.id === "capa")?.bolso).toBeUndefined();
    // Não altera a configuração original.
    expect(PASTA.faces[0]?.bolso).toBeUndefined();
  });

  it("pasta s/ bolso fica como está", () => {
    expect(aplicarBolsoPadrao(PASTA, "Pasta Avulso s/ Bolso")).toBe(PASTA);
  });

  it("configuração explícita vence (bolso: false desliga)", () => {
    const desligado: PapelariaMockupConfig = {
      ...PASTA,
      faces: PASTA.faces.map((f) => (f.id === "interior" ? { ...f, bolso: false as const } : f)),
    };
    expect(aplicarBolsoPadrao(desligado, "Pasta Avulso c/ Bolso")).toBe(desligado);
  });

  it("vale para o mockup salvo no produto", () => {
    const r = getPapelariaMockupConfig({
      produto: "Pasta Avulso c/ Bolso",
      mockupConfigJson: JSON.stringify(PASTA),
      pageCount: 1,
    });
    expect(r.config.faces.find((f) => f.id === "interior")?.bolso).toBe("pasta_avulso");
  });
});

describe("resolverBolso", () => {
  it("nome do padrão, objeto próprio ou nenhum", () => {
    expect(resolverBolso({ bolso: "pasta_avulso" })).toBe(BOLSO_PASTA_AVULSO);
    const proprio = { contorno: "M 0 100 L 100 100 L 100 80 Z" };
    expect(resolverBolso({ bolso: proprio })).toBe(proprio);
    expect(resolverBolso({ bolso: false })).toBeNull();
    expect(resolverBolso({})).toBeNull();
    expect(resolverBolso({ bolso: { contorno: " " } })).toBeNull();
  });

  it("faca da pasta: duas fendas e boca subindo para a direita", () => {
    expect(BOLSO_PASTA_AVULSO.cortes).toHaveLength(2);
    expect(BOLSO_PASTA_AVULSO.contorno.startsWith("M 0 100")).toBe(true);
  });
});

describe("encaixarCartao", () => {
  const cortesMm = (BOLSO_PASTA_AVULSO.cortes ?? []).map(
    ([x1, y1, x2, y2]) => [x1 * 2.2, y1 * 3.2, x2 * 2.2, y2 * 3.2] as [number, number, number, number],
  );

  it("cartão 90 × 50 quase reto, entre as duas fendas da pasta", () => {
    const e = encaixarCartao(cortesMm, 90, 50)!;
    expect(Math.abs(e.rotacaoGraus)).toBeLessThan(2);
    expect(e.cx).toBeCloseTo(140.9, 0);
    expect(e.cy).toBeCloseTo(274.7, 0);
    // Canto inferior esquerdo some na fenda de baixo (normal para baixo/esquerda).
    expect(e.fendas[0]!.canto[0]).toBeLessThan(0);
    expect(e.fendas[0]!.canto[1]).toBeGreaterThan(0);
  });

  it("cantos escondidos cabem nas fendas (cateto ≈ 19 mm < fenda de 29 mm)", () => {
    const e = encaixarCartao(cortesMm, 90, 50)!;
    const rad = (e.rotacaoGraus * Math.PI) / 180;
    const bl = [
      e.cx + (-45 * Math.cos(rad) - 25 * Math.sin(rad)),
      e.cy + (-45 * Math.sin(rad) + 25 * Math.cos(rad)),
    ];
    const [x1, y1, x2, y2] = cortesMm[1]!;
    const meio = [(x1 + x2) / 2, (y1 + y2) / 2];
    const entra = Math.hypot(bl[0]! - meio[0]!, bl[1]! - meio[1]!);
    expect(entra).toBeGreaterThan(10);
    expect(entra * Math.SQRT2).toBeLessThan(29);
  });

  it("sem duas fendas não encaixa", () => {
    expect(encaixarCartao([cortesMm[0]!], 90, 50)).toBeNull();
  });
});
