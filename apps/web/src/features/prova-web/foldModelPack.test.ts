import { describe, expect, it } from "vitest";

import type { FoldOperation } from "@/api/provaWeb";

import {
  applyFoldModelConfig,
  defaultFolhetoCrop,
  packFoldModelConfig,
} from "./provaWebFoldPresets";

describe("fold model pack/apply", () => {
  it("grava vincos, operações e páginas PDF", () => {
    const base = defaultFolhetoCrop(210, 297);
    const creases = [
      { id: "c1", axis: "vertical" as const, positionMm: 70 },
      { id: "c2", axis: "vertical" as const, positionMm: 140 },
    ];
    const operations: FoldOperation[] = [
      {
        id: "o1",
        creaseId: "c1",
        order: 1,
        movingSide: "positive",
        towards: "back",
        targetAngleDeg: 180,
      },
      {
        id: "o2",
        creaseId: "c2",
        order: 2,
        movingSide: "negative",
        towards: "front",
        targetAngleDeg: 180,
      },
    ];
    const folheto = {
      ...base,
      creases,
      operations,
      pageFrente: 2,
      pageVerso: 0,
      backArtworkTransform: {
        mirrorX: true,
        mirrorY: false,
        rotationDeg: 0 as const,
      },
    };
    const packed = packFoldModelConfig(folheto, 210, 297);
    expect(packed.pageFrente).toBe(2);
    expect(packed.pageVerso).toBe(0);
    expect(packed.operations[0]?.movingSide).toBe("positive");
    expect(packed.operations[0]?.towards).toBe("back");
    expect(packed.creases.length).toBe(2);
    expect(packed.backArtworkTransform?.mirrorX).toBe(true);

    const applied = applyFoldModelConfig(
      defaultFolhetoCrop(180, 250),
      packed,
      180,
      250,
      { pageCount: 4 },
    );
    expect(applied.pageFrente).toBe(2);
    expect(applied.pageVerso).toBe(0);
    expect(applied.operations[0]?.movingSide).toBe("positive");
    expect(applied.operations[0]?.towards).toBe("back");
    expect(applied.creases).toHaveLength(packed.creases.length);
  });

  it("pack/apply preserva startAfterPrevOpen01 (omite se 1)", () => {
    const base = defaultFolhetoCrop(210, 297);
    const folheto = {
      ...base,
      creases: [
        { id: "c1", axis: "vertical" as const, positionMm: 70 },
        { id: "c2", axis: "vertical" as const, positionMm: 140 },
      ],
      operations: [
        {
          id: "o1",
          creaseId: "c1",
          order: 1,
          movingSide: "negative" as const,
          towards: "front" as const,
          targetAngleDeg: 180,
          startAfterPrevOpen01: 0.2,
        },
        {
          id: "o2",
          creaseId: "c2",
          order: 2,
          movingSide: "positive" as const,
          towards: "front" as const,
          targetAngleDeg: 180,
          startAfterPrevOpen01: 1,
        },
      ],
    };
    const packed = packFoldModelConfig(folheto, 210, 297);
    expect(packed.operations.find((o) => o.id === "o1")?.startAfterPrevOpen01).toBe(
      0.2,
    );
    expect(
      packed.operations.find((o) => o.id === "o2")?.startAfterPrevOpen01,
    ).toBeUndefined();

    const applied = applyFoldModelConfig(defaultFolhetoCrop(), packed, 210, 297);
    expect(
      applied.operations.find((o) => o.id === "o1")?.startAfterPrevOpen01,
    ).toBe(0.2);
  });
});
