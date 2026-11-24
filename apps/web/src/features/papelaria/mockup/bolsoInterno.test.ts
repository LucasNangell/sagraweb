import { describe, expect, it } from "vitest";

import { aplicarBolsoPadrao, BOLSO_PASTA_AVULSO, produtoTemBolso, resolverBolso } from "./bolsoInterno";
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
