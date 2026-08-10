import { describe, expect, it } from "vitest";

import {
  formatPageSpec,
  isMarkVisibleOnPage,
  parsePageSpec,
  pageSpecIncludes,
  validatePageSpec,
} from "./analiseLabPageSpec";

describe("analiseLabPageSpec", () => {
  it("parses mixed ranges and singles", () => {
    expect(parsePageSpec("1-15,20,23,25-30")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 23, 25, 26, 27, 28,
      29, 30,
    ]);
  });

  it("canonicalizes overlaps", () => {
    expect(formatPageSpec(parsePageSpec("1-5,3-8"))).toBe("1-8");
  });

  it("rejects invalid specs", () => {
    expect(validatePageSpec("0")).toMatch(/>= 1/);
    expect(validatePageSpec("5-1")).toMatch(/inválido/i);
    expect(validatePageSpec("abc")).toMatch(/inválid/i);
    expect(validatePageSpec("")).toMatch(/Informe/);
  });

  it("checks visibility for all / single / spec", () => {
    expect(isMarkVisibleOnPage({ pagina: 0 }, 7)).toBe(true);
    expect(isMarkVisibleOnPage({ pagina: 3 }, 3)).toBe(true);
    expect(isMarkVisibleOnPage({ pagina: 3 }, 4)).toBe(false);
    expect(
      isMarkVisibleOnPage({ pagina: 1, paginas: "1-3,10" }, 2),
    ).toBe(true);
    expect(
      isMarkVisibleOnPage({ pagina: 1, paginas: "1-3,10" }, 4),
    ).toBe(false);
    expect(pageSpecIncludes("1-3,10", 10)).toBe(true);
  });
});
