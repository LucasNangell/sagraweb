import { describe, expect, it } from "vitest";

import type { ProvaWebPageMeta } from "@/api/provaWeb";

import {
  buildSpiralSheets,
  previousSheetVerso,
} from "./ProvaWebSpiralMockup3D";

function page(n: number, role: ProvaWebPageMeta["role"] = "page"): ProvaWebPageMeta {
  return {
    page: n,
    file: `page_${n}.png`,
    width: 100,
    height: 100,
    widthPt: 100,
    heightPt: 100,
    role,
    url: "",
  };
}

describe("buildSpiralSheets", () => {
  it("empilha pares frente/verso", () => {
    const sheets = buildSpiralSheets([
      page(1, "cover-front"),
      page(2),
      page(3),
      page(4, "cover-back"),
    ]);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.front.page).toBe(1);
    expect(sheets[0]!.back?.page).toBe(2);
    expect(sheets[1]!.front.page).toBe(3);
    expect(sheets[1]!.back?.page).toBe(4);
  });

  it("última folha sem verso fica back null", () => {
    const sheets = buildSpiralSheets([page(1), page(2), page(3)]);
    expect(sheets).toHaveLength(2);
    expect(sheets[1]!.back).toBeNull();
  });

  it("ignora blank", () => {
    const blank = { ...page(99), blank: true };
    const sheets = buildSpiralSheets([page(1), blank, page(2)]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.front.page).toBe(1);
    expect(sheets[0]!.back?.page).toBe(2);
  });
});

describe("previousSheetVerso", () => {
  const sheets = buildSpiralSheets([
    page(1),
    page(2),
    page(3),
    page(4),
    page(5),
    page(6),
  ]);

  it("folha 0 não tem verso anterior no bloco", () => {
    expect(previousSheetVerso(sheets, 0)).toBeNull();
  });

  it("folha atual mostra no verso do bloco o verso da anterior", () => {
    expect(previousSheetVerso(sheets, 1)?.page).toBe(2);
    expect(previousSheetVerso(sheets, 2)?.page).toBe(4);
  });
});
