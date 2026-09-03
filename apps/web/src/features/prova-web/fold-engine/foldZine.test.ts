import { describe, expect, it } from "vitest";

import { progressThroughStepOrder } from "../FoldStepPreview";
import { evaluateFoldState } from "./foldKinematics";
import { sheetFromPreset } from "./foldPresets";
import {
  buildFoldTopology,
  createHistoryAwareResolveMoving,
  detectInteriorPeelAfterFlap,
  progressWithPriorsClosed,
  resolveMovingPanels,
  resolveMovingPanelsWithHistory,
} from "./foldTopology";
import {
  DEFAULT_ARTWORK_BACK,
  DEFAULT_PHYSICAL,
  type FoldOperation,
} from "./foldTypes";
import { validateFoldDefinition } from "./foldValidation";

function sheetDef(preset: string, w = 420, h = 297) {
  const { creases, operations } = sheetFromPreset(preset, w, h);
  return {
    widthMm: w,
    heightMm: h,
    thicknessMm: 0.03,
    creases,
    operations,
    backArtworkTransform: DEFAULT_ARTWORK_BACK,
    physical: DEFAULT_PHYSICAL,
  };
}

describe("progressThroughStepOrder", () => {
  it("fecha ops até stepOrder e abre as seguintes", () => {
    const ops: FoldOperation[] = [
      {
        id: "o1",
        creaseId: "c1",
        order: 1,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
      {
        id: "o2",
        creaseId: "c2",
        order: 2,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
      {
        id: "o3",
        creaseId: "c3",
        order: 3,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
    ];
    const p = progressThroughStepOrder(ops, 2);
    expect(p.get("o1")).toBe(0);
    expect(p.get("o2")).toBe(0);
    expect(p.get("o3")).toBe(1);
  });
});

describe("zine / dobras sobre dobras", () => {
  it("preset zine_metades: grade 2×4 e 3 operações", () => {
    const def = sheetDef("zine_metades");
    const topo = buildFoldTopology(def);
    expect(topo.panels).toHaveLength(8);
    expect(def.creases).toHaveLength(4);
    expect(def.operations).toHaveLength(3);
    const issues = validateFoldDefinition(def);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("zine: após V+H fechadas, 3ª V move pilha {cols 1+2}, não col3", () => {
    const def = sheetDef("zine_metades", 400, 280);
    const topology = buildFoldTopology(def);
    const o3 = def.operations.find((o) => o.order === 3)!;

    const flat = resolveMovingPanels(topology, o3, def.creases);
    expect(flat.has("p0_3")).toBe(true);
    expect(flat.has("p1_3")).toBe(true);

    const stacked = resolveMovingPanelsWithHistory({
      topology,
      operation: o3,
      creases: def.creases,
      operations: def.operations,
      progressByOp: progressWithPriorsClosed(def.operations, o3),
      thicknessMm: 0.235,
    });

    expect([...stacked].sort()).toEqual(
      ["p0_1", "p0_2", "p1_1", "p1_2"].sort(),
    );
    expect(stacked.has("p0_0")).toBe(false);
    expect(stacked.has("p0_3")).toBe(false);
    expect(stacked.has("p1_0")).toBe(false);
    expect(stacked.has("p1_3")).toBe(false);
  });

  it("zine: solver fecha sem erro com resolve histórico", () => {
    const def = sheetDef("zine_metades", 400, 280);
    const topology = buildFoldTopology(def);
    const progressByOp = new Map(
      def.operations.map((o) => [o.id, 0] as const),
    );
    const resolveMoving = createHistoryAwareResolveMoving({
      topology,
      creases: def.creases,
      operations: def.operations,
      progressByOp,
      thicknessMm: 0.235,
    });
    const { errors } = evaluateFoldState({
      topology,
      creases: def.creases,
      operations: def.operations,
      progressByOp,
      resolveMoving,
      thicknessMm: 0.235,
    });
    expect(errors).toEqual([]);
  });

  it("aviso interior_peel em grade 2×3 V→H→V", () => {
    const w = 300;
    const h = 200;
    const creases = [
      { id: "cv1", axis: "vertical" as const, positionMm: 100 },
      { id: "cv2", axis: "vertical" as const, positionMm: 200 },
      { id: "ch", axis: "horizontal" as const, positionMm: 100 },
    ];
    const operations: FoldOperation[] = [
      {
        id: "o1",
        creaseId: "cv1",
        order: 1,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
      {
        id: "o2",
        creaseId: "ch",
        order: 2,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
      {
        id: "o3",
        creaseId: "cv2",
        order: 3,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
      },
    ];
    const def = {
      widthMm: w,
      heightMm: h,
      thicknessMm: 0.22,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    };
    const topology = buildFoldTopology(def);
    const peel = detectInteriorPeelAfterFlap(topology, creases, operations);
    expect(peel?.code).toBe("interior_peel_zine");
    const issues = validateFoldDefinition(def);
    expect(issues.some((i) => i.code === "interior_peel_zine")).toBe(true);
  });
});

describe("regressão BFS plano = histórico sem priors ativos", () => {
  for (const preset of [
    "biparte_vertical",
    "triptico_carteira_esquerda",
    "triptico_carteira_direita",
    "enrolada_4",
    "cruzado_v_primeiro",
  ] as const) {
    it(`${preset}: 1ª op idêntica ao BFS`, () => {
      const def = sheetDef(preset, 210, 297);
      const topology = buildFoldTopology(def);
      const first = [...def.operations].sort((a, b) => a.order - b.order)[0]!;
      const flat = resolveMovingPanels(topology, first, def.creases);
      const hist = resolveMovingPanelsWithHistory({
        topology,
        operation: first,
        creases: def.creases,
        operations: def.operations,
        progressByOp: progressWithPriorsClosed(def.operations, first),
      });
      expect([...hist].sort()).toEqual([...flat].sort());
    });
  }

  it("enrolada: 2ª e 3ª acumulam como BFS (priors fechados, mesma conectividade)", () => {
    const def = sheetDef("enrolada_4", 200, 280);
    const topology = buildFoldTopology(def);
    for (const op of def.operations) {
      const flat = resolveMovingPanels(topology, op, def.creases);
      const hist = resolveMovingPanelsWithHistory({
        topology,
        operation: op,
        creases: def.creases,
        operations: def.operations,
        progressByOp: progressWithPriorsClosed(def.operations, op),
        thicknessMm: 0.235,
      });
      // Enrolada outer→inner: partição mundial deve preservar o conjunto do BFS
      expect([...hist].sort()).toEqual([...flat].sort());
    }
  });

  it("carteira: 2ª aba continua só o painel lateral", () => {
    const def = sheetDef("triptico_carteira_direita", 210, 297);
    const topology = buildFoldTopology(def);
    const o2 = def.operations.find((o) => o.order === 2)!;
    const hist = resolveMovingPanelsWithHistory({
      topology,
      operation: o2,
      creases: def.creases,
      operations: def.operations,
      progressByOp: progressWithPriorsClosed(def.operations, o2),
      thicknessMm: 0.235,
    });
    expect([...hist]).toEqual(["p0"]);
  });
});
