import { describe, expect, it } from "vitest";

import {
  defaultFolhetoCrop,
  hydrateFolhetoFromInitial,
  isLegacyFolhetoConfig,
} from "./provaWebFoldPresets";

describe("hydrateFolhetoFromInitial", () => {
  it("restaura creases, operações e crop do cropJson", () => {
    const saved = {
      ...defaultFolhetoCrop(),
      preset: "biparte_vertical" as const,
      crop: { top: 2, right: 3, bottom: 4, left: 5, source: "manual" as const },
      creases: [{ id: "c1", axis: "vertical" as const, positionMm: 105 }],
      operations: [
        {
          id: "o1",
          creaseId: "c1",
          order: 1,
          movingSide: "positive" as const,
          towards: "back" as const,
          targetAngleDeg: 180,
          startAfterPrevOpen01: 0.4,
        },
      ],
      pageFrente: 0,
      pageVerso: 1,
      basePanelId: "p0",
    };
    const hydrated = hydrateFolhetoFromInitial(saved);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.preset).toBe("biparte_vertical");
    expect(hydrated!.crop.left).toBe(5);
    expect(hydrated!.creases).toHaveLength(1);
    expect(hydrated!.operations[0]?.startAfterPrevOpen01).toBe(0.4);
    expect(hydrated!.basePanelId).toBe("p0");
  });

  it("rejeita config legado sem creases/operations", () => {
    const legacy = {
      preset: "biparte_vertical",
      dobras: [
        {
          id: "d1",
          eixo: "vertical",
          posicaoMm: 105,
          sentido: "valley",
          ordem: 1,
        },
      ],
    };
    expect(isLegacyFolhetoConfig(legacy)).toBe(true);
    expect(hydrateFolhetoFromInitial(legacy)).toBeNull();
  });

  it("retorna null para entrada vazia", () => {
    expect(hydrateFolhetoFromInitial(null)).toBeNull();
    expect(hydrateFolhetoFromInitial({})).toBeNull();
  });
});
