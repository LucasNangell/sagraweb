import { describe, expect, it } from "vitest";

import {
  OS_SEARCH_SAFETY_POLL_MS,
  OS_SEARCH_STALE_MS,
} from "./useOsSearch";

describe("useOsSearch constants", () => {
  it("usa staleTime moderado com invalidação via WebSocket", () => {
    expect(OS_SEARCH_STALE_MS).toBe(30_000);
  });

  it("define polling de segurança leve de 120 segundos", () => {
    expect(OS_SEARCH_SAFETY_POLL_MS).toBe(120_000);
  });
});
