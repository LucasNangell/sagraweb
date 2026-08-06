import { describe, expect, it } from "vitest";

import { sheetFromPreset } from "./foldPresets";
import {
  buildFoldTopology,
  resolveMovingPanels,
  resolveMovingSideForBase,
  syncOperationsToBasePanel,
} from "./foldTopology";
import { DEFAULT_ARTWORK_BACK, DEFAULT_PHYSICAL } from "./foldTypes";

describe("painel base (miolo)", () => {
  it("com base p1, vinco esquerdo usa móvel negativo (só p0)", () => {
    const { creases, operations } = sheetFromPreset(
      "triptico_carteira_direita",
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
    const leftCrease = creases.find((c) => c.id === "c1")!;
    const side = resolveMovingSideForBase(
      topology,
      leftCrease,
      creases,
      "p1",
    );
    expect(side).toBe("negative");
    const moving = resolveMovingPanels(
      topology,
      {
        id: "tmp",
        creaseId: "c1",
        order: 1,
        movingSide: side!,
        towards: "front",
        targetAngleDeg: 180,
      },
      creases,
    );
    expect([...moving]).toEqual(["p0"]);
  });

  it("sync força carteira: abas isoladas e centro parado", () => {
    const creases = [
      { id: "c1", axis: "vertical" as const, positionMm: 70 },
      { id: "c2", axis: "vertical" as const, positionMm: 140 },
    ];
    // Config “errada” do usuário: ambos móvel direito
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
    ];
    const topology = buildFoldTopology({
      widthMm: 210,
      heightMm: 297,
      thicknessMm: 0.235,
      creases,
      operations,
      backArtworkTransform: DEFAULT_ARTWORK_BACK,
      physical: DEFAULT_PHYSICAL,
    });
    const synced = syncOperationsToBasePanel(
      topology,
      creases,
      operations,
      "p1",
    );
    expect(synced[0]!.movingSide).toBe("negative");
    expect(synced[1]!.movingSide).toBe("positive");
    expect([...resolveMovingPanels(topology, synced[0]!, creases)]).toEqual([
      "p0",
    ]);
    expect([...resolveMovingPanels(topology, synced[1]!, creases)]).toEqual([
      "p2",
    ]);
  });
});
