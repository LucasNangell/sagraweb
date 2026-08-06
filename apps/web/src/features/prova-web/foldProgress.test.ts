import { describe, expect, it } from "vitest";

import {
  resolveOperationProgress,
  unfoldLevelProgress,
} from "./fold-engine/foldProgress";

describe("resolveOperationProgress stagger", () => {
  const twoLevels = [
    { id: "o1", order: 1 },
    { id: "o2", order: 2 },
  ];

  it("sem campo (= default 1) equivale à fórmula legado open_i = clamp(p*n - i)", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const map = resolveOperationProgress(twoLevels, p);
      // levels DESC: order 2 = index 0, order 1 = index 1
      expect(map.get("o2")).toBeCloseTo(unfoldLevelProgress(p, 2, 0), 10);
      expect(map.get("o1")).toBeCloseTo(unfoldLevelProgress(p, 2, 1), 10);
    }
  });

  it("startAfterPrevOpen01: 1 explícito também é legado", () => {
    const ops = [
      { id: "o1", order: 1, startAfterPrevOpen01: 1 },
      { id: "o2", order: 2, startAfterPrevOpen01: 1 },
    ];
    for (const p of [0, 0.5, 1]) {
      const map = resolveOperationProgress(ops, p);
      expect(map.get("o2")).toBeCloseTo(unfoldLevelProgress(p, 2, 0), 10);
      expect(map.get("o1")).toBeCloseTo(unfoldLevelProgress(p, 2, 1), 10);
    }
  });

  it("n=1: open = unfold01", () => {
    const map = resolveOperationProgress([{ id: "o1", order: 1 }], 0.37);
    expect(map.get("o1")).toBeCloseTo(0.37, 10);
  });

  it("stagger 0.2: nível 1 começa quando o anterior (order 2) atinge 20% aberto", () => {
    const ops = [
      { id: "o1", order: 1, startAfterPrevOpen01: 0.2 },
      { id: "o2", order: 2 },
    ];
    // starts=[0, 0.2], total=1.2
    // open_o2 = clamp(p*1.2 - 0); open_o1 = clamp(p*1.2 - 0.2)
    // o1 starts when o2 open = 0.2 ⇒ p*1.2 = 0.2 ⇒ p = 0.2/1.2
    const pStart = 0.2 / 1.2;
    const atStart = resolveOperationProgress(ops, pStart);
    expect(atStart.get("o2")).toBeCloseTo(0.2, 5);
    expect(atStart.get("o1")!).toBeGreaterThanOrEqual(0);
    expect(atStart.get("o1")!).toBeLessThan(0.05);

    const after = resolveOperationProgress(ops, pStart + 0.05);
    expect(after.get("o1")!).toBeGreaterThan(0);
    expect(after.get("o2")!).toBeGreaterThan(0.2);
  });

  it("wait=0: ambos com o mesmo open01", () => {
    const ops = [
      { id: "o1", order: 1, startAfterPrevOpen01: 0 },
      { id: "o2", order: 2 },
    ];
    for (const p of [0, 0.3, 0.7, 1]) {
      const map = resolveOperationProgress(ops, p);
      expect(map.get("o1")).toBeCloseTo(map.get("o2")!, 10);
      expect(map.get("o1")).toBeCloseTo(p, 10);
    }
  });

  it("mesmo order: max wait do nível", () => {
    const ops = [
      { id: "a", order: 1, startAfterPrevOpen01: 0.1 },
      { id: "b", order: 1, startAfterPrevOpen01: 0.5 },
      { id: "c", order: 2 },
    ];
    // levels [2,1], wait for level1 = max(0.1,0.5)=0.5
    // starts=[0, 0.5], total=1.5
    const p = 0.5 / 1.5;
    const map = resolveOperationProgress(ops, p);
    expect(map.get("c")).toBeCloseTo(0.5, 5);
    expect(map.get("a")).toBeCloseTo(0, 5);
    expect(map.get("b")).toBeCloseTo(0, 5);
  });

  it("três níveis default = legado n=3", () => {
    const ops = [
      { id: "o1", order: 1 },
      { id: "o2", order: 2 },
      { id: "o3", order: 3 },
    ];
    const p = 0.5;
    const map = resolveOperationProgress(ops, p);
    expect(map.get("o3")).toBeCloseTo(unfoldLevelProgress(p, 3, 0), 10);
    expect(map.get("o2")).toBeCloseTo(unfoldLevelProgress(p, 3, 1), 10);
    expect(map.get("o1")).toBeCloseTo(unfoldLevelProgress(p, 3, 2), 10);
  });
});
