import { describe, expect, it } from "vitest";

import {
  defaultFolhetoCrop,
  hydrateFolhetoFromInitial,
  isLegacyFolhetoConfig,
  resolveFolhetoDuplexPages,
} from "./provaWebFoldPresets";

describe("resolveFolhetoDuplexPages", () => {
  it("restaura frente=1 / verso=0 quando ambos colidem em 0 (clamp pageCount=1)", () => {
    expect(resolveFolhetoDuplexPages(2, 0, 0)).toEqual({
      pageFrente: 1,
      pageVerso: 0,
    });
  });

  it("restaura padrão quando verso some e frente ficou em 0", () => {
    expect(resolveFolhetoDuplexPages(2, 0, null)).toEqual({
      pageFrente: 1,
      pageVerso: 0,
    });
  });

  it("preserva invertido frente=0 / verso=1", () => {
    expect(resolveFolhetoDuplexPages(2, 0, 1)).toEqual({
      pageFrente: 0,
      pageVerso: 1,
    });
  });

  it("PDF de uma página: sem verso", () => {
    expect(resolveFolhetoDuplexPages(1, 1, 0)).toEqual({
      pageFrente: 0,
      pageVerso: null,
    });
  });
});

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
