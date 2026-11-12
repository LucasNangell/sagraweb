import { describe, expect, it } from "vitest";

import { papelariaSpJobUiKey } from "./papelariaSpJobUi";

describe("papelariaSpJobUiKey", () => {
  it("monta chave ano-nro", () => {
    expect(papelariaSpJobUiKey(2026, 5123)).toBe("2026-5123");
  });
});
