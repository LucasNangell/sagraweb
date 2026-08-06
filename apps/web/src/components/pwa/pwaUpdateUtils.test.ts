import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchServerBuildId,
  isClientBuildOutdated,
} from "@/components/pwa/pwaUpdateUtils";

describe("isClientBuildOutdated", () => {
  it("retorna false quando client ou server estão vazios", () => {
    expect(isClientBuildOutdated("", "a")).toBe(false);
    expect(isClientBuildOutdated("a", "")).toBe(false);
    expect(isClientBuildOutdated(null, "a")).toBe(false);
    expect(isClientBuildOutdated("a", null)).toBe(false);
  });

  it("retorna false quando os build_ids são iguais", () => {
    expect(isClientBuildOutdated("build_1", "build_1")).toBe(false);
    expect(isClientBuildOutdated("  build_1  ", "build_1")).toBe(false);
  });

  it("retorna true quando os build_ids diferem", () => {
    expect(isClientBuildOutdated("build_old", "build_new")).toBe(true);
  });
});

describe("fetchServerBuildId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna o build_id do JSON quando a resposta é ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ build_id: "build_server" }),
    });
    await expect(fetchServerBuildId(fetchImpl as typeof fetch)).resolves.toBe(
      "build_server",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/app-version"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("retorna null quando a resposta falha", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchServerBuildId(fetchImpl as typeof fetch)).resolves.toBeNull();
  });
});
