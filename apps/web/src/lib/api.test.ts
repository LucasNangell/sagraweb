import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { fetchCurrentSession } from "@/features/auth/api";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("403 propaga mensagem de bloqueio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => JSON.stringify({ detail: "Acesso não autorizado." }),
      }),
    );

    await expect(apiFetch("/permissions")).rejects.toThrow(
      "Acesso não autorizado.",
    );
  });

  it("500 lança Error tratável (não lança exceção não capturável)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Error",
        text: async () => "Internal error",
      }),
    );

    await expect(apiFetch("/os/search")).rejects.toBeInstanceOf(Error);
    await expect(apiFetch("/os/search")).rejects.toThrow(/500/);
  });
});

describe("fetchCurrentSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 retorna null (sessão inválida)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const me = await fetchCurrentSession();
    expect(me).toBeNull();
  });

  it("403 retorna null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      }),
    );

    expect(await fetchCurrentSession()).toBeNull();
  });
});
