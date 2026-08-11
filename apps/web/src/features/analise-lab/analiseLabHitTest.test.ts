import { describe, expect, it } from "vitest";

import type { AnaliseLabMark } from "@/api/analiseLab";

import { hitTestMarkAt } from "./analiseLabHitTest";

function mark(
  partial: Partial<AnaliseLabMark> &
    Pick<AnaliseLabMark, "id" | "tipo" | "geometria">,
): AnaliseLabMark {
  return {
    sessaoId: 1,
    pagina: 1,
    cor: "red",
    ...partial,
  };
}

describe("analiseLabHitTest", () => {
  it("acerta ponto e retângulo", () => {
    const marks = [
      mark({
        id: 1,
        tipo: "ponto",
        geometria: { xMm: 10, yMm: 20 },
      }),
      mark({
        id: 2,
        tipo: "retangulo",
        geometria: { xMm: 40, yMm: 40, wMm: 30, hMm: 20 },
      }),
    ];
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 10,
        yMm: 20,
        tolMm: 2,
      }),
    ).toBe(1);
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 50,
        yMm: 50,
        tolMm: 1,
      }),
    ).toBe(2);
  });

  it("acerta faixa e traço livre; clique fora retorna null", () => {
    const marks = [
      mark({
        id: 3,
        tipo: "faixa",
        geometria: { edge: "top", fromMm: 5, toMm: 12 },
      }),
      mark({
        id: 4,
        tipo: "livre",
        geometria: {
          points: [
            [0, 50],
            [40, 50],
            [80, 50],
          ],
        },
      }),
    ];
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 20,
        yMm: 8,
        tolMm: 1,
      }),
    ).toBe(3);
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 40,
        yMm: 50,
        tolMm: 2,
      }),
    ).toBe(4);
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 90,
        yMm: 90,
        tolMm: 1,
      }),
    ).toBeNull();
  });

  it("empate fica com a marca mais recente", () => {
    const marks = [
      mark({
        id: 10,
        tipo: "ponto",
        geometria: { xMm: 5, yMm: 5 },
      }),
      mark({
        id: 20,
        tipo: "ponto",
        geometria: { xMm: 5, yMm: 5 },
      }),
    ];
    expect(
      hitTestMarkAt({
        marks,
        pageNumber: 1,
        pageWidthMm: 100,
        pageHeightMm: 100,
        xMm: 5,
        yMm: 5,
        tolMm: 2,
      }),
    ).toBe(20);
  });
});
