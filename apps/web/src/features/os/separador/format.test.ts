import { describe, expect, it } from "vitest";

import {
  cadSequence,
  formatCadNumero,
  formatSeparadorMeta,
  formatSeparadorOs,
  parseCadUntil,
} from "./format";

describe("formatSeparadorOs", () => {
  it("usa nros/ano sem prefixo", () => {
    expect(formatSeparadorOs(2532, 2026)).toBe("2532/2026");
  });
});

describe("formatSeparadorMeta", () => {
  it("trim e usa traço quando vazio", () => {
    expect(formatSeparadorMeta("  Ata  ")).toBe("Ata");
    expect(formatSeparadorMeta("")).toBe("—");
    expect(formatSeparadorMeta(null)).toBe("—");
  });
});

describe("formatCadNumero", () => {
  it("preenche com dois dígitos", () => {
    expect(formatCadNumero(1)).toBe("01");
    expect(formatCadNumero(9)).toBe("09");
    expect(formatCadNumero(12)).toBe("12");
  });
});

describe("parseCadUntil", () => {
  it("aceita 1 a 99", () => {
    expect(parseCadUntil("3")).toEqual({ ok: true, until: 3 });
    expect(parseCadUntil(" 99 ")).toEqual({ ok: true, until: 99 });
  });

  it("rejeita vazio, não inteiro e fora do teto", () => {
    expect(parseCadUntil("").ok).toBe(false);
    expect(parseCadUntil("1.5").ok).toBe(false);
    expect(parseCadUntil("0").ok).toBe(false);
    expect(parseCadUntil("100").ok).toBe(false);
  });
});

describe("cadSequence", () => {
  it("gera 01 até N", () => {
    expect(cadSequence(3)).toEqual(["01", "02", "03"]);
  });

  it("não gera sequência inválida", () => {
    expect(cadSequence(0)).toEqual([]);
    expect(cadSequence(100)).toEqual([]);
  });
});
