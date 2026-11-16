import { describe, expect, it } from "vitest";

import { formatProvaLabel } from "./resolveProductDimensionsMm";

describe("formatProvaLabel", () => {
  it("formata Prova N a partir da versão", () => {
    expect(formatProvaLabel("1")).toBe("Prova 1");
    expect(formatProvaLabel(3)).toBe("Prova 3");
  });

  it("retorna null sem versão útil", () => {
    expect(formatProvaLabel(null)).toBeNull();
    expect(formatProvaLabel(undefined)).toBeNull();
    expect(formatProvaLabel("")).toBeNull();
    expect(formatProvaLabel("   ")).toBeNull();
  });
});
