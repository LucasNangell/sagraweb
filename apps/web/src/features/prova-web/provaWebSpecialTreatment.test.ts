import { describe, expect, it } from "vitest";

import type { ProvaWebBookStructureInsert } from "@/api/provaWeb";

import {
  foldMockupFromSpecialTreatment,
  resolvedSpecialFoldLines,
  specialTreatmentPagePixels,
  verticalFoldPanels,
} from "./provaWebSpecialTreatment";

function treatment(
  kind: ProvaWebBookStructureInsert["kind"],
  extra: Partial<ProvaWebBookStructureInsert> = {},
): ProvaWebBookStructureInsert {
  return {
    id: "encarte-1",
    label: "Encarte",
    sourceComponent: "miolo",
    sourcePageStart: 2,
    sourcePageEnd: 2,
    kind,
    widthMm: 420,
    heightMm: 297,
    ...extra,
  };
}

describe("provaWebSpecialTreatment", () => {
  it("preserva dobras configuradas explicitamente", () => {
    expect(
      resolvedSpecialFoldLines(
        treatment("foldout", {
          foldLines: [{ axis: "vertical", positionMm: 140 }],
        }),
      ),
    ).toEqual([{ axis: "vertical", positionMm: 140 }]);
  });

  it("infere vinco central para dobra simples sem linhas explícitas", () => {
    expect(resolvedSpecialFoldLines(treatment("foldout"))).toEqual([
      { axis: "vertical", positionMm: 210 },
    ]);
  });

  it("infere vincos em terços para z-fold", () => {
    expect(resolvedSpecialFoldLines(treatment("zfold"))).toEqual([
      { axis: "vertical", positionMm: 140 },
      { axis: "vertical", positionMm: 280 },
    ]);
  });

  it("divide a prévia em painéis a partir dos vincos verticais", () => {
    expect(verticalFoldPanels(treatment("zfold"))).toEqual([
      { index: 0, leftPct: 0, widthPct: 33.33333333333333 },
      { index: 1, leftPct: 33.33333333333333, widthPct: 33.33333333333333 },
      { index: 2, leftPct: 66.66666666666666, widthPct: 33.33333333333333 },
    ]);
  });

  it("calcula a dimensão visual real em relação à página comum", () => {
    expect(
      specialTreatmentPagePixels({
        treatment: treatment("foldout"),
        basePixelSize: { width: 350, height: 495 },
        basePageMm: { widthMm: 210, heightMm: 297 },
      }),
    ).toMatchObject({
      width: 700,
      height: 495,
      widthRatio: 2,
      heightRatio: 1,
    });
  });

  it("monta mockup biparte para encarte dobrado", () => {
    const mockup = foldMockupFromSpecialTreatment(treatment("foldout"));
    expect(mockup).toMatchObject({
      preset: "biparte_vertical",
      pageWidthMm: 420,
      pageHeightMm: 297,
      hasVerso: false,
      ready: true,
    });
    expect(mockup?.panels).toHaveLength(2);
    expect(mockup?.creases).toEqual([{ id: "c1", axis: "vertical", positionMm: 210 }]);
    expect(mockup?.operations).toHaveLength(1);
  });

  it("desloca o vinco do foldout conforme closedWidthMm", () => {
    const mockup = foldMockupFromSpecialTreatment(
      treatment("foldout", { closedWidthMm: 140 }),
    );
    expect(mockup?.creases).toEqual([{ id: "c1", axis: "vertical", positionMm: 140 }]);
  });

  it("monta mockup sanfona para z-fold", () => {
    const mockup = foldMockupFromSpecialTreatment(treatment("zfold"));
    expect(mockup?.preset).toBe("triptico_sanfona_vertical");
    expect(mockup?.panels).toHaveLength(3);
    expect(mockup?.operations).toEqual([
      {
        id: "o1",
        creaseId: "c1",
        order: 1,
        movingSide: "negative",
        towards: "front",
        targetAngleDeg: 180,
      },
      {
        id: "o2",
        creaseId: "c2",
        order: 2,
        movingSide: "positive",
        towards: "back",
        targetAngleDeg: 180,
      },
    ]);
  });

  it("monta mockup portão com operações em fase", () => {
    const mockup = foldMockupFromSpecialTreatment(treatment("gatefold"));
    expect(mockup?.preset).toBe("portao");
    expect(mockup?.panels).toHaveLength(3);
    expect(mockup?.operations).toEqual([
      {
        id: "o1",
        creaseId: "c1",
        order: 1,
        movingSide: "negative",
        towards: "front",
        targetAngleDeg: 180,
        phaseId: "gate",
      },
      {
        id: "o2",
        creaseId: "c2",
        order: 1,
        movingSide: "positive",
        towards: "front",
        targetAngleDeg: 180,
        phaseId: "gate",
      },
    ]);
  });

  it("não gera mockup 3D para encarte simples ou página maior", () => {
    expect(foldMockupFromSpecialTreatment(treatment("insert"))).toBeNull();
    expect(foldMockupFromSpecialTreatment(treatment("large-sheet"))).toBeNull();
  });

  it("monta mockup a partir de foldConfig em custom-fold", () => {
    const mockup = foldMockupFromSpecialTreatment(
      treatment("custom-fold", {
        hasVerso: true,
        sourcePageEnd: 3,
        foldConfig: {
          version: 1,
          creases: [
            { id: "c1", axis: "vertical", positionFrac: 1 / 3 },
            { id: "c2", axis: "vertical", positionFrac: 2 / 3 },
          ],
          operations: [
            {
              id: "o1",
              creaseId: "c1",
              order: 1,
              movingSide: "negative",
              towards: "front",
              targetAngleDeg: 180,
            },
            {
              id: "o2",
              creaseId: "c2",
              order: 2,
              movingSide: "positive",
              towards: "back",
              targetAngleDeg: 180,
            },
          ],
        },
      }),
    );
    expect(mockup?.preset).toBe("personalizada");
    expect(mockup?.hasVerso).toBe(true);
    expect(mockup?.panels).toHaveLength(3);
    expect(mockup?.creases).toHaveLength(2);
    expect(mockup?.operations).toHaveLength(2);
  });

  it("propaga hasVerso no mockup de kinds clássicos", () => {
    const mockup = foldMockupFromSpecialTreatment(
      treatment("foldout", {
        hasVerso: true,
        sourcePageEnd: 4,
        foldLines: [{ axis: "vertical", positionMm: 210 }],
      }),
    );
    expect(mockup?.hasVerso).toBe(true);
  });
});
