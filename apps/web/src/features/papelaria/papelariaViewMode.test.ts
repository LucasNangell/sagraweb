import { describe, expect, it } from "vitest";

import { resolveDefaultPapelariaViewMode } from "./papelariaViewMode";

describe("resolveDefaultPapelariaViewMode", () => {
  it("abre prova quando já existe PDF", () => {
    expect(resolveDefaultPapelariaViewMode(true)).toBe("prova");
  });

  it("abre prévia quando não há prova", () => {
    expect(resolveDefaultPapelariaViewMode(false)).toBe("previa");
  });
});
