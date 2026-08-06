import { describe, expect, it } from "vitest";

import { closedAngleRad, unfoldLevelProgress } from "./fold-engine/foldProgress";
import { quantizeMm } from "./fold-engine/foldNormalization";
import { sheetFromPreset } from "./fold-engine/foldPresets";
import {
  buildFoldTopology,
  resolveMovingPanels,
} from "./fold-engine/foldTopology";
import { DEFAULT_ARTWORK_BACK, DEFAULT_PHYSICAL } from "./fold-engine/foldTypes";
import { validateFoldDefinition } from "./fold-engine/foldValidation";
import { defaultPanelPages } from "./fold-engine/foldPages";

function defFromPreset(preset: string, w = 210, h = 297) {
  const { creases, operations } = sheetFromPreset(preset, w, h);
  return {
    widthMm: w,
    heightMm: h,
    thicknessMm: 0.22,
    creases,
    operations,
    backArtworkTransform: DEFAULT_ARTWORK_BACK,
    physical: DEFAULT_PHYSICAL,
  };
}

describe("foldProgress", () => {
  it("abre níveis na ordem inversa (0 fechado → 1 aberto)", () => {
    expect(unfoldLevelProgress(0, 2, 0)).toBe(0);
    expect(unfoldLevelProgress(0.5, 2, 0)).toBe(1);
    expect(unfoldLevelProgress(0.5, 2, 1)).toBe(0);
    expect(unfoldLevelProgress(1, 2, 1)).toBe(1);
  });

  it("interpola ângulo fechado → 0", () => {
    const closed = closedAngleRad(170, 1, 0);
    expect(closed).toBeCloseTo((170 * Math.PI) / 180, 5);
    expect(closedAngleRad(170, 1, 1)).toBeCloseTo(0, 5);
  });
});

describe("foldTopology", () => {
  it("quantizeMm colapsa floats próximos", () => {
    expect(quantizeMm(99.999999)).toBe(100);
    expect(quantizeMm(100)).toBe(100);
  });

  it("biparte: conjunto móvel positivo = painel direito", () => {
    const def = defFromPreset("biparte_vertical");
    const topo = buildFoldTopology(def);
    expect(topo.panels).toHaveLength(2);
    const op = def.operations[0]!;
    const moving = resolveMovingPanels(topo, op, def.creases);
    expect([...moving]).toEqual(["p1"]);
  });

  it("biparte: lado negativo = painel esquerdo", () => {
    const def = defFromPreset("biparte_vertical");
    def.operations[0]!.movingSide = "negative";
    const topo = buildFoldTopology(def);
    const moving = resolveMovingPanels(topo, def.operations[0]!, def.creases);
    expect([...moving]).toEqual(["p0"]);
  });

  it("carteira direita: roll acumula painéis no segundo fecho", () => {
    const def = defFromPreset("triptico_carteira_direita");
    const topo = buildFoldTopology(def);
    expect(topo.panels).toHaveLength(3);
    const first = def.operations.find((o) => o.order === 1)!;
    const m1 = resolveMovingPanels(topo, first, def.creases);
    expect(m1.has("p2")).toBe(true);
    expect(m1.size).toBe(1);
  });

  it("sanfona e carteira usam o mesmo caminho de topologia", () => {
    for (const preset of [
      "triptico_sanfona_vertical",
      "triptico_carteira_esquerda",
      "sanfona_4",
      "cruzado_v_primeiro",
    ] as const) {
      const def = defFromPreset(preset);
      const issues = validateFoldDefinition(def);
      expect(issues.filter((i) => i.level === "error")).toEqual([]);
      const topo = buildFoldTopology(def);
      expect(topo.panels.length).toBeGreaterThan(1);
    }
  });

  it("default panel pages tipográfico", () => {
    const def = defFromPreset("triptico_sanfona_vertical");
    const topo = buildFoldTopology(def);
    expect(defaultPanelPages(topo.panels, true)).toEqual([
      { panelId: "p0", frontPage: 1, backPage: 6 },
      { panelId: "p1", frontPage: 2, backPage: 5 },
      { panelId: "p2", frontPage: 3, backPage: 4 },
    ]);
  });
});
