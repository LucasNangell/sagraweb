import { describe, expect, it } from "vitest";

import {
  papelariaSpJobUiKey,
  type PapelariaSpJobUiStatus,
} from "./papelariaSpJobUi";

describe("papelariaSpJobUiKey", () => {
  it("monta chave ano-nro", () => {
    expect(papelariaSpJobUiKey(2026, 5123)).toBe("2026-5123");
  });
});

describe("PapelariaSpJobUiStatus", () => {
  it("distingue pendência de processamento", () => {
    const pending: PapelariaSpJobUiStatus = "pending";
    const generating: PapelariaSpJobUiStatus = "generating";
    const done: PapelariaSpJobUiStatus = "done";
    expect([pending, generating, done]).toEqual([
      "pending",
      "generating",
      "done",
    ]);
  });
});
