import { describe, expect, it } from "vitest";

import {
  papelariaGenerationStatusLabel,
  resolvePapelariaGenerationPhase,
} from "./papelariaGenerationStatus";

describe("resolvePapelariaGenerationPhase", () => {
  it("prioriza pending/processing do job ativo", () => {
    expect(
      resolvePapelariaGenerationPhase(true, { status: "processing" }),
    ).toBe("processing");
    expect(resolvePapelariaGenerationPhase(false, { status: "pending" })).toBe(
      "pending",
    );
  });

  it("usa submitting quando gera sem job em pipeline", () => {
    expect(
      resolvePapelariaGenerationPhase(true, { status: "completed" }),
    ).toBe("submitting");
    expect(resolvePapelariaGenerationPhase(true, null)).toBe("submitting");
  });

  it("expõe failed/cancelled quando não está gerando", () => {
    expect(resolvePapelariaGenerationPhase(false, { status: "failed" })).toBe(
      "failed",
    );
    expect(
      resolvePapelariaGenerationPhase(false, { status: "cancelled" }),
    ).toBe("cancelled");
  });
});

describe("papelariaGenerationStatusLabel", () => {
  it("monta textos de fila e processamento", () => {
    expect(
      papelariaGenerationStatusLabel("pending", { ordemFila: 2 }).detail,
    ).toContain("Na fila");
    expect(papelariaGenerationStatusLabel("processing").detail).toContain(
      "Processando",
    );
  });
});
