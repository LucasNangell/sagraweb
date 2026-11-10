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

describe("apiFetch — sessão e rede", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("403 com code de sessão notifica o recuperador e expõe o code", async () => {
    const { onSessionProblem, isSessionError } = await import("@/lib/sessionEvents");
    const seen: string[] = [];
    const off = onSessionProblem((code) => seen.push(code));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () =>
          JSON.stringify({ detail: "Sessão ausente", code: "session_invalid" }),
      }),
    );

    const err = await apiFetch("/os/search").catch((e: unknown) => e);
    off();
    expect(isSessionError(err)).toBe(true);
    expect(seen).toEqual(["session_invalid"]);
    expect((err as Error).message).toMatch(/sessão expirou/i);
  });

  it("falha de rede vira mensagem clara com code network", async () => {
    const { isNetworkError } = await import("@/lib/sessionEvents");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const err = await apiFetch("/os/search").catch((e: unknown) => e);
    expect(isNetworkError(err)).toBe(true);
    expect((err as Error).message).toMatch(/conectar ao servidor/i);
  });

  it("403 de permissão não é tratado como sessão", async () => {
    const { isSessionError } = await import("@/lib/sessionEvents");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => JSON.stringify({ detail: "Acesso não autorizado." }),
      }),
    );
    const err = await apiFetch("/permissions").catch((e: unknown) => e);
    expect(isSessionError(err)).toBe(false);
    expect((err as { status?: number }).status).toBe(403);
  });
});

describe("fetchCurrentSession — falha transitória", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("500 lança erro (não desloga o usuário)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" }),
    );
    await expect(fetchCurrentSession()).rejects.toThrow(/500/);
  });
});
