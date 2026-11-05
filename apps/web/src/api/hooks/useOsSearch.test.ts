import { describe, expect, it } from "vitest";

import {
  OS_SEARCH_SAFETY_POLL_MS,
  OS_SEARCH_STALE_MS,
} from "./useOsSearch";

describe("useOsSearch constants", () => {
  it("usa staleTime de 30s; invalidação continua via WebSocket", () => {
    expect(OS_SEARCH_STALE_MS).toBe(30_000);
  });

  it("não faz poll contínuo da home (fallback só com WS offline)", () => {
    expect(OS_SEARCH_SAFETY_POLL_MS).toBe(120_000);
  });
});
