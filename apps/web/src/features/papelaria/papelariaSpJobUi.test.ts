import { describe, expect, it } from "vitest";

import {
  papelariaSpJobUiFromJobStatus,
  papelariaSpJobUiKey,
} from "./papelariaSpJobUi";

describe("papelariaSpJobUiKey", () => {
  it("monta chave ano-nro", () => {
    expect(papelariaSpJobUiKey(2026, 5123)).toBe("2026-5123");
  });
});

describe("papelariaSpJobUiFromJobStatus", () => {
  it("mapeia pending/processing/completed", () => {
    expect(papelariaSpJobUiFromJobStatus("pending")).toBe("pending");
    expect(papelariaSpJobUiFromJobStatus("processing")).toBe("generating");
    expect(papelariaSpJobUiFromJobStatus("completed")).toBe("done");
    expect(papelariaSpJobUiFromJobStatus("failed")).toBeNull();
    expect(papelariaSpJobUiFromJobStatus("cancelled")).toBeNull();
  });
});
