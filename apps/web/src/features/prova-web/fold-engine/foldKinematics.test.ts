import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  adjacentMovingPanelId,
  evaluateFoldState,
  matrixIsFinite,
} from "./foldKinematics";
import { resolveOperationProgress } from "./foldProgress";
import { sheetFromPreset } from "./foldPresets";
import { buildFoldTopology, resolveMovingPanels } from "./foldTopology";
import {
  DEFAULT_ARTWORK_BACK,
  DEFAULT_PHYSICAL,
  type FoldOperation,
} from "./foldTypes";

function panelCenterZ(m: THREE.Matrix4): number {
  return new THREE.Vector3(0, 0, 0).applyMatrix4(m).z;
}

describe("foldKinematics", () => {
  it("folha aberta (unfold=1) restaura identidade / matrizes finitas", () => {
    const { creases, operations } = sheetFromPreset(
      "triptico_carteira_direita",
      210,
      297,
    );
    const topology = buildFoldTopology({
      widthMm: 210,
      heightMm: 297,
      thicknessMm: 0.22,
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
    for (const m of matrices.values()) {
      expect(matrixIsFinite(m)).toBe(true);
    }
  });

  it("determinístico: mesmo progresso ⇒ mesmas matrizes", () => {
    const { creases, operations } = sheetFromPreset("sanfona_4", 200, 280);
    const topology = buildFoldTopology({
      widthMm: 200,
      heightMm: 280,
      thicknessMm: 0.22,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    });
    const progress = resolveOperationProgress(operations, 0.35);
    const a = evaluateFoldState({
      topology,
      creases,
      operations,
      progressByOp: progress,
      resolveMoving: (op) => resolveMovingPanels(topology, op, creases),
    });
    const b = evaluateFoldState({
      topology,
      creases,
      operations,
      progressByOp: progress,
      resolveMoving: (op) => resolveMovingPanels(topology, op, creases),
    });
    for (const id of a.matrices.keys()) {
      expect(a.matrices.get(id)!.elements).toEqual(b.matrices.get(id)!.elements);
    }
  });

  it("biparte: dobra para frente levanta +Z; para verso −Z", () => {
    for (const towards of ["front", "back"] as const) {
      const { creases, operations: base } = sheetFromPreset(
        "biparte_vertical",
        200,
        280,
      );
      const operations: FoldOperation[] = base.map((o) => ({ ...o, towards }));
      const topology = buildFoldTopology({
        widthMm: 200,
        heightMm: 280,
        thicknessMm: 0.22,
        creases,
        operations,
        backArtworkTransform: DEFAULT_ARTWORK_BACK,
        physical: DEFAULT_PHYSICAL,
      });
      const resolveMoving = (op: FoldOperation) =>
        resolveMovingPanels(topology, op, creases);
      const op = operations[0]!;
      const crease = creases.find((c) => c.id === op.creaseId)!;
      const seedId = adjacentMovingPanelId(
        topology,
        crease,
        resolveMoving(op),
      )!;
      const { matrices, errors } = evaluateFoldState({
        topology,
        creases,
        operations,
        progressByOp: resolveOperationProgress(operations, 0.5),
        resolveMoving,
        thicknessMm: 0.235,
      });
      expect(errors).toEqual([]);
      const z = panelCenterZ(matrices.get(seedId)!);
      expect(Math.abs(z)).toBeGreaterThan(5);
      expect(Math.sign(z)).toBe(towards === "front" ? 1 : -1);
    }
  });

  it("sanfona+stagger: sentido Z estável ao atravessar ~55%", () => {
    const { creases, operations: baseOps } = sheetFromPreset(
      "sanfona_4",
      200,
      280,
    );
    const maxOrder = Math.max(...baseOps.map((o) => o.order));
    const operations: FoldOperation[] = baseOps.map((o) =>
      o.order < maxOrder ? { ...o, startAfterPrevOpen01: 0.05 } : { ...o },
    );
    const topology = buildFoldTopology({
      widthMm: 200,
      heightMm: 280,
      thicknessMm: 0.22,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    });
    const resolveMoving = (op: FoldOperation) =>
      resolveMovingPanels(topology, op, creases);

    const topOp = operations.find((o) => o.order === maxOrder)!;
    const crease = creases.find((c) => c.id === topOp.creaseId)!;
    const moving = resolveMoving(topOp);
    const seedId = adjacentMovingPanelId(topology, crease, moving);
    expect(seedId).toBeTruthy();

    function zAt(unfold01: number): number {
      const progress = resolveOperationProgress(operations, unfold01);
      const { matrices, errors } = evaluateFoldState({
        topology,
        creases,
        operations,
        progressByOp: progress,
        resolveMoving,
        thicknessMm: 0.235,
      });
      expect(errors).toEqual([]);
      return panelCenterZ(matrices.get(seedId!)!);
    }

    const samples = [0, 0.25, 0.45, 0.55, 0.75, 1] as const;
    const zs = samples.map((u) => zAt(u));

    // Parcialmente fechado abaixo e acima de 55%: mesmo lado (sem inversão).
    const z45 = zs[2]!;
    const z55 = zs[3]!;
    expect(Math.abs(z45)).toBeGreaterThan(0.5);
    expect(Math.abs(z55)).toBeGreaterThan(0.5);
    expect(Math.sign(z45)).toBe(Math.sign(z55));

    // Abrir aproxima do plano ( |Z| reduz de 0.45 → 0.55 → 0.75 → 1 ).
    expect(Math.abs(zs[3]!)).toBeLessThanOrEqual(Math.abs(zs[2]!) + 1e-6);
    expect(Math.abs(zs[4]!)).toBeLessThanOrEqual(Math.abs(zs[3]!) + 1e-6);
    expect(Math.abs(zs[5]!)).toBeLessThan(2);
  });

  it("carteira wait=1: fechado e aberto finitos (não-regressão)", () => {
    for (const preset of [
      "triptico_carteira_esquerda",
      "triptico_carteira_direita",
    ] as const) {
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
      const resolveMoving = (op: FoldOperation) =>
        resolveMovingPanels(topology, op, creases);
      for (const unfold of [0, 1] as const) {
        const { matrices, errors } = evaluateFoldState({
          topology,
          creases,
          operations,
          progressByOp: resolveOperationProgress(operations, unfold),
          resolveMoving,
          thicknessMm: 0.235,
        });
        expect(errors).toEqual([]);
        for (const m of matrices.values()) {
          expect(matrixIsFinite(m)).toBe(true);
        }
      }
    }
  });
});
