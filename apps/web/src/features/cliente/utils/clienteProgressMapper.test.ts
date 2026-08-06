import { describe, expect, it } from "vitest";

import type { ClienteOsItem, ClienteTimelineStep } from "@/api/cliente-portal";

import {
  deriveStepVisualState,
  estimateStepIndexFromOsItem,
  lastCompletedIndex,
  mapTimelineToProgressSteps,
  progressPercent,
  resolveProgressSteps,
} from "./clienteProgressMapper";

function makeStep(overrides: Partial<ClienteTimelineStep> = {}): ClienteTimelineStep {
  return {
    ordem: 1,
    situacao: "Entrada Inicial",
    setor: "SECOG",
    concluido: false,
    ...overrides,
  };
}

function makeOsItem(overrides: Partial<ClienteOsItem> = {}): ClienteOsItem {
  return {
    nr_os: 100,
    ano: 2025,
    titulo: "Teste",
    produto: "Folder",
    situacao: "Entrada Inicial",
    setor: "SECOG",
    ...overrides,
  };
}

describe("lastCompletedIndex", () => {
  it("retorna índice do último step concluído", () => {
    const steps = [
      makeStep({ concluido: true }),
      makeStep({ concluido: true }),
      makeStep({ concluido: false }),
    ];
    expect(lastCompletedIndex(steps)).toBe(1);
  });
});

describe("deriveStepVisualState", () => {
  it("marca pendência como warning", () => {
    const steps = [makeStep({ pendencia_label: "Resolver" })];
    expect(deriveStepVisualState(steps[0], 0, steps)).toBe("warning");
  });

  it("marca concluído como done", () => {
    const steps = [
      makeStep({ ordem: 1, concluido: true }),
      makeStep({ ordem: 2, concluido: false }),
    ];
    expect(deriveStepVisualState(steps[0], 0, steps)).toBe("done");
  });
});

describe("estimateStepIndexFromOsItem", () => {
  it("estima pré-impressão para Saída p/ SEFOC", () => {
    expect(
      estimateStepIndexFromOsItem(makeOsItem({ situacao: "Saída p/", setor: "SEFOC" })),
    ).toBe(1);
  });

  it("estima impressão para Saída p/ SEIMP", () => {
    expect(
      estimateStepIndexFromOsItem(makeOsItem({ situacao: "Saída p/", setor: "SEIMP" })),
    ).toBe(3);
  });
});

describe("mapTimelineToProgressSteps", () => {
  it("gera 7 steps a partir da timeline", () => {
    const steps = Array.from({ length: 7 }, (_, i) =>
      makeStep({ ordem: i + 1, concluido: i < 2 }),
    );
    const result = mapTimelineToProgressSteps(steps);
    expect(result).toHaveLength(7);
    expect(result[0].state).toBe("done");
    expect(result[2].state).toBe("current");
  });
});

describe("resolveProgressSteps", () => {
  it("usa timeline quando disponível", () => {
    const timeline = Array.from({ length: 7 }, (_, i) =>
      makeStep({ ordem: i + 1, concluido: i === 0 }),
    );
    const result = resolveProgressSteps(makeOsItem(), timeline, false);
    expect(result.isEstimated).toBe(false);
    expect(result.steps).toHaveLength(7);
  });

  it("usa fallback estimado sem timeline", () => {
    const result = resolveProgressSteps(
      makeOsItem({ situacao: "Em Execução", setor: "SEFOC" }),
      undefined,
      false,
    );
    expect(result.isEstimated).toBe(true);
    expect(result.steps.some((s) => s.state === "current")).toBe(true);
  });
});

describe("progressPercent", () => {
  it("calcula percentual com steps concluídos", () => {
    const steps = mapTimelineToProgressSteps([
      makeStep({ concluido: true }),
      makeStep({ concluido: true }),
      makeStep({ concluido: false }),
      makeStep({ concluido: false }),
      makeStep({ concluido: false }),
      makeStep({ concluido: false }),
      makeStep({ concluido: false }),
    ]);
    expect(progressPercent(steps)).toBeGreaterThan(0);
  });
});
