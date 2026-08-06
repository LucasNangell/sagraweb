import { describe, expect, it } from "vitest";

import { getPapelariaMockupConfig } from "./getPapelariaMockupConfig";

describe("getPapelariaMockupConfig", () => {
  it("prioriza match por arquivoModelo", () => {
    const r = getPapelariaMockupConfig({
      arquivoModelo: "CtVisitaFV.cdr",
      produto: "Ct Duplo Retrato Lateral",
    });
    expect(r.config.id).toBe("cartao_visita_frente_verso");
    expect(r.isFallback).toBe(false);
  });

  it("resolve Ct Duplo Retrato Lateral por produto", () => {
    const r = getPapelariaMockupConfig({
      produto: "Ct Duplo Retrato Lateral",
      pageCount: 2,
    });
    expect(r.config.id).toBe("cartao_duplo_retrato_lateral");
    expect(r.isFallback).toBe(false);
  });

  it("resolve Timbrado A4", () => {
    const r = getPapelariaMockupConfig({ produto: "Timbrado A4" });
    expect(r.config.id).toBe("folha_a4_simples");
  });

  it("fallback com 2 paginas usa cartao dobrado generico", () => {
    const r = getPapelariaMockupConfig({
      produto: "Produto Desconhecido",
      pageCount: 2,
    });
    expect(r.config.id).toBe("cartao_duplo_retrato_lateral");
    expect(r.isFallback).toBe(true);
  });

  it("fallback final folha_simples", () => {
    const r = getPapelariaMockupConfig({ produto: "X", pageCount: 1 });
    expect(r.config.id).toBe("folha_simples");
    expect(r.isFallback).toBe(true);
  });

  it("prioriza MockupConfigJson do banco", () => {
    const custom = JSON.stringify({
      id: "custom",
      nome: "Custom",
      modo: "folha_simples",
      larguraAbertaMm: 210,
      alturaAbertaMm: 297,
      orientacao: "retrato",
      faces: [{ id: "p", nome: "P", pageIndex: 0, style3d: {} }],
    });
    const r = getPapelariaMockupConfig({
      mockupConfigJson: custom,
      produto: "Ct Duplo Retrato Lateral",
    });
    expect(r.config.id).toBe("custom");
    expect(r.source).toBe("db");
    expect(r.isFallback).toBe(false);
  });

  it("json invalido do banco usa fallback generico", () => {
    const r = getPapelariaMockupConfig({ mockupConfigJson: "{invalid" });
    expect(r.isInvalid).toBe(true);
    expect(r.isFallback).toBe(true);
    expect(r.config.id).toBe("folha_simples");
  });
});
