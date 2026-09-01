import { describe, expect, it } from "vitest";

import { normalizeAno, parseOsAnoPair } from "./osAnoUtils";

describe("normalizeAno", () => {
  it("expande 2 dígitos", () => {
    expect(normalizeAno(26)).toBe(2026);
    expect(normalizeAno("26")).toBe(2026);
  });

  it("aceita 4 dígitos na faixa", () => {
    expect(normalizeAno(2026)).toBe(2026);
  });

  it("rejeita 3 dígitos", () => {
    expect(normalizeAno(216)).toBeNull();
  });

  it("rejeita fora da faixa", () => {
    expect(normalizeAno(1999)).toBeNull();
    expect(normalizeAno(2101)).toBeNull();
  });
});

describe("parseOsAnoPair", () => {
  it("monta par válido", () => {
    expect(parseOsAnoPair(1396, 26)).toEqual({ os: 1396, ano: 2026 });
  });

  it("recusa ano 216", () => {
    expect(parseOsAnoPair(1396, 216)).toBeNull();
  });
});
