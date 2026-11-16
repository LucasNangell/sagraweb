import { describe, expect, it } from "vitest";

import { resolveDefaultPapelariaViewMode } from "./papelariaViewMode";

describe("resolveDefaultPapelariaViewMode", () => {
  it("abre prova quando já existe PDF (assinatura legada)", () => {
    expect(resolveDefaultPapelariaViewMode(true)).toBe("prova");
  });

  it("abre prévia quando não há prova (assinatura legada)", () => {
    expect(resolveDefaultPapelariaViewMode(false)).toBe("previa");
  });

  it("prioriza imposição quando há arquivo Digital", () => {
    expect(
      resolveDefaultPapelariaViewMode({
        hasImposicao: true,
        hasProof: true,
      }),
    ).toBe("imposicao");
  });

  it("prioriza imposição quando aguarda Apogee", () => {
    expect(
      resolveDefaultPapelariaViewMode({
        waitingApogee: true,
        hasProof: true,
      }),
    ).toBe("imposicao");
  });

  it("abre prova quando há prova e não há imposição", () => {
    expect(
      resolveDefaultPapelariaViewMode({
        hasProof: true,
        hasImposicao: false,
      }),
    ).toBe("prova");
  });

  it("abre prévia quando não há prova nem imposição", () => {
    expect(resolveDefaultPapelariaViewMode({})).toBe("previa");
  });
});
