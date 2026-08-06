import { describe, expect, it } from "vitest";

import {
  evaluateFoldState,
  matrixIsFinite,
  matrixIsTranslationOnly,
} from "./foldKinematics";
import { resolveOperationProgress } from "./foldProgress";
import { sheetFromPreset } from "./foldPresets";
import { buildFoldTopology, resolveMovingPanels } from "./foldTopology";
import { DEFAULT_ARTWORK_BACK, DEFAULT_PHYSICAL } from "./foldTypes";

function closedWallet(preset: "triptico_carteira_esquerda" | "triptico_carteira_direita") {
  const { creases, operations } = sheetFromPreset(preset, 210, 297);
  const topology = buildFoldTopology({
    widthMm: 210,
    heightMm: 297,
    thicknessMm: 0.235,
    creases,
    operations,
    backArtworkTransform: DEFAULT_ARTWORK_BACK,
    physical: DEFAULT_PHYSICAL,
  });
  const resolveMoving = (op: (typeof operations)[0]) =>
    resolveMovingPanels(topology, op, creases);
  const progress = resolveOperationProgress(operations, 0);
  const result = evaluateFoldState({
    topology,
    creases,
    operations,
    progressByOp: progress,
    resolveMoving,
    thicknessMm: 0.235,
  });
  return { topology, creases, operations, resolveMoving, result };
}

describe("carteira C-fold", () => {
  it("esquerda→direita: centro parado; abas móveis isoladas", () => {
    const { topology, operations, resolveMoving, result } = closedWallet(
      "triptico_carteira_esquerda",
    );
    expect(result.errors).toEqual([]);
    expect(topology.panels.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);

    const left = operations.find((o) => o.order === 1)!;
    const right = operations.find((o) => o.order === 2)!;
    expect([...resolveMoving(left)].sort()).toEqual(["p0"]);
    expect([...resolveMoving(right)].sort()).toEqual(["p2"]);
    expect(resolveMoving(left).has("p1")).toBe(false);
    expect(resolveMoving(right).has("p1")).toBe(false);

    const center = result.matrices.get("p1")!;
    expect(matrixIsTranslationOnly(center)).toBe(true);
    for (const m of result.matrices.values()) {
      expect(matrixIsFinite(m)).toBe(true);
    }

    // 2ª aba empilhada acima da 1ª (offset Z no fecho)
    const z0 = result.matrices.get("p0")!.elements[14]!;
    const z2 = result.matrices.get("p2")!.elements[14]!;
    expect(Math.abs(z2)).toBeGreaterThan(Math.abs(z0) - 1e-6);
  });

  it("direita→esquerda: simétrico; centro parado", () => {
    const { operations, resolveMoving, result } = closedWallet(
      "triptico_carteira_direita",
    );
    expect(result.errors).toEqual([]);
    const first = operations.find((o) => o.order === 1)!;
    const second = operations.find((o) => o.order === 2)!;
    expect([...resolveMoving(first)]).toEqual(["p2"]);
    expect([...resolveMoving(second)]).toEqual(["p0"]);
    expect(matrixIsTranslationOnly(result.matrices.get("p1")!)).toBe(true);

    const z2 = result.matrices.get("p2")!.elements[14]!;
    const z0 = result.matrices.get("p0")!.elements[14]!;
    // Segunda (p0) deve ter maior |offset| de camada
    expect(Math.abs(z0)).toBeGreaterThan(Math.abs(z2) - 1e-6);
  });

  it("folha aberta restaura sem NaN", () => {
    const { creases, operations } = sheetFromPreset(
      "triptico_carteira_esquerda",
      210,
      297,
    );
    const topology = buildFoldTopology({
      widthMm: 210,
      heightMm: 297,
      thicknessMm: 0.235,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    });
    const progress = resolveOperationProgress(operations, 1);
    const { matrices, errors } = evaluateFoldState({
      topology,
      creases,
      operations,
      progressByOp: progress,
      resolveMoving: (op) => resolveMovingPanels(topology, op, creases),
      thicknessMm: 0.235,
    });
    expect(errors).toEqual([]);
    for (const m of matrices.values()) expect(matrixIsFinite(m)).toBe(true);
  });
});
