import { describe, expect, it } from "vitest";

import type { BoxModelConfig } from "@/api/boxModels";

import { boxMockupFromConfig } from "./boxMockupFromConfig";

const sampleConfig = (): BoxModelConfig => ({
  version: 1,
  pageWidthMm: 200,
  pageHeightMm: 150,
  cutBboxMm: {
    x0Mm: 0,
    y0Mm: 0,
    x1Mm: 200,
    y1Mm: 150,
    widthMm: 200,
    heightMm: 150,
  },
  panels: [
    {
      id: "p0",
      polygonMm: [],
      xMm: 0,
      yMm: 50,
      wMm: 100,
      hMm: 50,
      u0: 0,
      v0: 0.33,
      u1: 0.5,
      v1: 0.66,
    },
    {
      id: "p1",
      polygonMm: [],
      xMm: 100,
      yMm: 50,
      wMm: 100,
      hMm: 50,
      u0: 0.5,
      v0: 0.33,
      u1: 1,
      v1: 0.66,
    },
  ],
  hinges: [
    {
      id: "h0",
      panelA: "p0",
      panelB: "p1",
      axis: "vertical",
      positionMm: 100,
      spanStartMm: 50,
      spanEndMm: 100,
    },
  ],
  operations: [
    {
      id: "op0",
      hingeId: "h0",
      panelId: "p1",
      order: 1,
      movingSide: "positive",
      towards: "front",
      targetAngleDeg: 90,
    },
  ],
  basePanelId: "p0",
});

describe("boxMockupFromConfig", () => {
  it("monta mockup graph com parent nas operations", () => {
    const mock = boxMockupFromConfig(sampleConfig());
    expect(mock.template).toBe("graph");
    expect(mock.source).toBe("box_model");
    expect(mock.panels).toHaveLength(2);
    expect(mock.panels.find((p) => p.id === "p1")?.parentId).toBe("p0");
    expect(mock.openOperations).toHaveLength(1);
    expect(mock.netWidthMm).toBe(200);
  });

  it("re-raiz a árvore ao trocar a base", () => {
    const cfg = sampleConfig();
    cfg.basePanelId = "p1";
    const mock = boxMockupFromConfig(cfg);
    expect(mock.panels.find((p) => p.id === "p0")?.parentId).toBe("p1");
    expect(mock.panels.find((p) => p.id === "p1")?.parentId).toBeNull();
    expect(mock.openOperations[0]?.panelId).toBe("p0");
  });
});
