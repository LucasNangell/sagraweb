import { describe, expect, it } from "vitest";

import { nextBookExtraId, normalizeBookExtras } from "./provaWebBookExtras";

describe("provaWebBookExtras", () => {
  it("normaliza encarte configurado por página do miolo", () => {
    const extras = normalizeBookExtras({
      version: 1,
      inserts: [
        {
          id: "Encarte Miolo",
          label: "Mapa dobrado",
          sourceComponent: "miolo",
          sourcePageStart: "12",
          sourcePageEnd: "13",
          kind: "foldout",
          widthMm: "420.25",
          heightMm: "297.14",
          foldLines: [{ axis: "vertical", positionMm: "210" }],
          hasVerso: true,
        },
      ],
    });

    expect(extras.inserts).toEqual([
      expect.objectContaining({
        id: "Encarte-Miolo",
        label: "Mapa dobrado",
        sourceComponent: "miolo",
        sourcePageStart: 12,
        sourcePageEnd: 13,
        kind: "foldout",
        widthMm: 420.3,
        heightMm: 297.1,
        hasVerso: true,
        foldConfig: null,
      }),
    ]);
    expect(extras.inserts[0].foldLines).toEqual([
      { axis: "vertical", positionMm: 210 },
    ]);
  });

  it("desliga hasVerso quando frente e verso são a mesma página", () => {
    const extras = normalizeBookExtras({
      version: 1,
      inserts: [
        {
          id: "x",
          label: "X",
          sourceComponent: "miolo",
          sourcePageStart: 2,
          sourcePageEnd: 2,
          kind: "zfold",
          widthMm: 420,
          heightMm: 297,
          hasVerso: true,
        },
      ],
    });
    expect(extras.inserts[0].hasVerso).toBe(false);
  });

  it("normaliza custom-fold com foldConfig", () => {
    const extras = normalizeBookExtras({
      version: 1,
      inserts: [
        {
          id: "custom-1",
          label: "Pasta",
          sourceComponent: "unico",
          sourcePageStart: 1,
          sourcePageEnd: 2,
          kind: "custom-fold",
          widthMm: 420,
          heightMm: 297,
          hasVerso: true,
          foldConfig: {
            version: 1,
            creases: [{ id: "c1", axis: "vertical", positionFrac: 0.5 }],
            operations: [
              {
                id: "o1",
                creaseId: "c1",
                order: 1,
                movingSide: "positive",
                towards: "front",
                targetAngleDeg: 180,
              },
            ],
          },
        },
      ],
    });
    expect(extras.inserts[0].kind).toBe("custom-fold");
    expect(extras.inserts[0].hasVerso).toBe(true);
    expect(extras.inserts[0].foldConfig).toMatchObject({
      creases: [{ id: "c1", axis: "vertical", positionFrac: 0.5 }],
      operations: [expect.objectContaining({ creaseId: "c1" })],
    });
  });

  it("ignora foldConfig inválido em custom-fold", () => {
    const extras = normalizeBookExtras({
      version: 1,
      inserts: [
        {
          id: "bad",
          kind: "custom-fold",
          sourceComponent: "miolo",
          sourcePageStart: 1,
          sourcePageEnd: 1,
          widthMm: 210,
          heightMm: 297,
          foldConfig: { creases: [], operations: [] },
        },
      ],
    });
    expect(extras.inserts[0].foldConfig).toBeNull();
  });

  it("gera próximo id livre", () => {
    expect(
      nextBookExtraId([
        {
          id: "encarte-1",
          label: "A",
          sourceComponent: "miolo",
          sourcePageStart: 1,
          sourcePageEnd: 1,
          kind: "insert",
          widthMm: 210,
          heightMm: 297,
        },
      ]),
    ).toBe("encarte-2");
  });
});
