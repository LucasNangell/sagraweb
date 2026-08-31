import { describe, expect, it } from "vitest";

import { formatDataExtensoBrasilia, formatDateBr, formatDateForInput } from "@/lib/format";

describe("formatDataExtensoBrasilia", () => {
  it("formata data civil no estilo do ofício", () => {
    expect(formatDataExtensoBrasilia("2026-01-12")).toBe(
      "Brasília, 12 de janeiro de 2026.",
    );
  });

  it("usa hoje quando o valor está vazio", () => {
    const now = new Date();
    const meses = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    expect(formatDataExtensoBrasilia(undefined)).toBe(
      `Brasília, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}.`,
    );
  });
});

describe("formatDateBr", () => {
  it("preserva data civil YYYY-MM-DD sem deslocar fuso", () => {
    expect(formatDateBr("2026-08-12")).toBe("12/08/2026");
  });

  it("trata prefixo ISO com horário como data civil", () => {
    expect(formatDateBr("2026-08-12T00:00:00")).toBe("12/08/2026");
    expect(formatDateBr("2026-08-12T00:00:00.000Z")).toBe("12/08/2026");
  });

  it("retorna vazio e inválidos sem alterar", () => {
    expect(formatDateBr(null)).toBe("");
    expect(formatDateBr(undefined)).toBe("");
    expect(formatDateBr("")).toBe("");
    expect(formatDateBr("não-é-data")).toBe("não-é-data");
  });
});

describe("formatDateForInput", () => {
  it("preserva data civil YYYY-MM-DD sem deslocar fuso", () => {
    expect(formatDateForInput("2026-08-12")).toBe("2026-08-12");
  });

  it("trata prefixo ISO com horário como data civil", () => {
    expect(formatDateForInput("2026-08-12T00:00:00")).toBe("2026-08-12");
    expect(formatDateForInput("2026-08-12T00:00:00.000Z")).toBe("2026-08-12");
  });

  it("retorna vazio para nulos e inválidos", () => {
    expect(formatDateForInput(null)).toBe("");
    expect(formatDateForInput(undefined)).toBe("");
    expect(formatDateForInput("")).toBe("");
    expect(formatDateForInput("não-é-data")).toBe("");
  });
});
