import { describe, expect, it } from "vitest";

import {
  buildFoldTopology,
  progressWithPriorsClosed,
  resolveMovingPanels,
  resolveMovingPanelsWithHistory,
} from "./fold-engine/foldTopology";
import {
  DEFAULT_ARTWORK_BACK,
  DEFAULT_PHYSICAL,
} from "./fold-engine/foldTypes";
import { validateFoldDefinition } from "./fold-engine/foldValidation";
import {
  clampCreasePosition,
  ensureMirrorCrease,
} from "./provaWebFoldPresets";

describe("clampCreasePosition", () => {
  it("afasta 2ª vertical quando o meio já está ocupado", () => {
    const w = 400;
    const existing = [
      { id: "c1", axis: "vertical" as const, positionMm: 200 },
    ];
    const pos = clampCreasePosition(200, "vertical", w, 280, existing);
    expect(Math.abs(pos - 200)).toBeGreaterThanOrEqual(15);
    expect(pos).toBeGreaterThanOrEqual(15);
    expect(pos).toBeLessThanOrEqual(w - 15);
  });
});

describe("ensureMirrorCrease", () => {
  it("com V no meio + V em 1/4 acrescenta espelho em 3/4", () => {
    const w = 420;
    const mid = { id: "c1", axis: "vertical" as const, positionMm: 210 };
    const q = { id: "c3", axis: "vertical" as const, positionMm: 105 };
    let n = 4;
    const out = ensureMirrorCrease([mid, q], "vertical", 105, w, () => `c${n++}`);
    expect(out).toHaveLength(3);
    const positions = out.map((c) => c.positionMm).sort((a, b) => a - b);
    expect(positions[0]).toBeCloseTo(105, 0);
    expect(positions[1]).toBeCloseTo(210, 0);
    expect(positions[2]).toBeCloseTo(315, 0);
  });

  it("não espelha carteira (1/3 + 2/3)", () => {
    const w = 300;
    const creases = [
      { id: "c1", axis: "vertical" as const, positionMm: 100 },
      { id: "c2", axis: "vertical" as const, positionMm: 200 },
    ];
    // Pedido artificial perto de 75 (1/4 de 300) — extras fora do meio bloqueiam
    const out = ensureMirrorCrease(
      [...creases, { id: "c3", axis: "vertical", positionMm: 75 }],
      "vertical",
      75,
      w,
      () => "c99",
    );
    expect(out).toHaveLength(3);
    expect(out.some((c) => Math.abs(c.positionMm - 225) < 1)).toBe(false);
  });

  it("V→H→V sequencial: grade 2×4 e op3 move cols 1+2 na pilha", () => {
    const w = 420;
    const h = 297;
    const c1 = { id: "c1", axis: "vertical" as const, positionMm: w / 2 };
    const c2 = { id: "c2", axis: "horizontal" as const, positionMm: h / 2 };
    const c3Pos = clampCreasePosition(w * 0.25, "vertical", w, h, [c1, c2]);
    const c3 = { id: "c3", axis: "vertical" as const, positionMm: c3Pos };
    let seq = 4;
    const creases = ensureMirrorCrease(
      [c1, c2, c3],
      "vertical",
      c3Pos,
      w,
      () => `c${seq++}`,
    );
    expect(creases.filter((c) => c.axis === "vertical")).toHaveLength(3);

    const operations = [
      {
        id: "o1",
        creaseId: "c1",
        order: 1,
        movingSide: "positive" as const,
        towards: "front" as const,
        targetAngleDeg: 180,
      },
      {
        id: "o2",
        creaseId: "c2",
        order: 2,
        movingSide: "positive" as const,
        towards: "front" as const,
        targetAngleDeg: 180,
      },
      {
        id: "o3",
        creaseId: "c3",
        order: 3,
        movingSide: "positive" as const,
        towards: "front" as const,
        targetAngleDeg: 180,
      },
    ];
    const def = {
      widthMm: w,
      heightMm: h,
      thicknessMm: 0.03,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    };
    const topo = buildFoldTopology(def);
    expect(topo.panels).toHaveLength(8);

    const o3 = operations[2]!;
    const stacked = resolveMovingPanelsWithHistory({
      topology: topo,
      operation: o3,
      creases,
      operations,
      progressByOp: progressWithPriorsClosed(operations, o3),
      thicknessMm: 0.03,
    });
    expect([...stacked].sort()).toEqual(
      ["p0_1", "p0_2", "p1_1", "p1_2"].sort(),
    );
    expect(stacked.has("p0_0")).toBe(false);
    expect(stacked.has("p0_3")).toBe(false);

    const flat = resolveMovingPanels(topo, o3, creases);
    expect(flat.has("p0_3")).toBe(true);

    const errors = validateFoldDefinition(def).filter(
      (i) => i.level === "error",
    );
    expect(errors).toEqual([]);
  });
});
