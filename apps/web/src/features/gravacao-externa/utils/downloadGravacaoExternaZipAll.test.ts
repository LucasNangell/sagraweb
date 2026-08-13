import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { downloadGravacaoExternaZipAll } from "./downloadGravacaoExternaZipAll";

describe("downloadGravacaoExternaZipAll", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });

  function mockAnchorClick(): ReturnType<typeof vi.fn> {
    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") {
        el.click = click;
      }
      return el;
    });
    return click;
  }

  it("reports preparing phase then throws on API error when picker is used", async () => {
    const phases: string[] = [];
    const abort = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ abort });

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({ createWritable, remove }),
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Sessão não encontrada." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      downloadGravacaoExternaZipAll("/api/zip", {
        fallbackFilename: "x.zip",
        onPhase: (p) => phases.push(p),
      }),
    ).rejects.toThrow(/Sessão não encontrada/);

    expect(phases[0]).toBe("preparing");
    expect(phases.at(-1)).toBe("error");
    expect(abort).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("goes straight to native download when File System Access is unavailable", async () => {
    const phases: string[] = [];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll("/api/zip-url", {
      fallbackFilename: "x.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(phases).toEqual(["started"]);
    expect(click).toHaveBeenCalled();
  });

  it("calls showSaveFilePicker before fetch starts", async () => {
    const order: string[] = [];
    const streamBody = {
      pipeTo: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        order.push("picker");
        return {
          createWritable: vi.fn().mockResolvedValue({}),
          getFile: vi.fn().mockResolvedValue({ size: 3 }),
        };
      }),
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      order.push("fetch-started");
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === "Content-Length" ? "3" : null),
        },
        body: streamBody,
      } as unknown as Response;
    });

    const phases: string[] = [];
    await downloadGravacaoExternaZipAll("/api/zip-order", {
      fallbackFilename: "pack.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(order[0]).toBe("picker");
    expect(order.indexOf("picker")).toBeLessThan(order.indexOf("fetch-started"));
    expect(streamBody.pipeTo).toHaveBeenCalled();
    expect(phases.at(-1)).toBe("idle");
  });

  it("falls back to native download on SecurityError from picker", async () => {
    const phases: string[] = [];
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockRejectedValue(
        new DOMException(
          "Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.",
          "SecurityError",
        ),
      ),
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll("/api/zip-gesture", {
      fallbackFilename: "x.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(phases).toEqual(["started"]);
    expect(click).toHaveBeenCalled();
  });

  it("falls back to native download when Content-Length does not match saved size", async () => {
    const phases: string[] = [];
    const remove = vi.fn().mockResolvedValue(undefined);
    const streamBody = {
      pipeTo: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({}),
        getFile: vi.fn().mockResolvedValue({ size: 1 }),
        remove,
      }),
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name === "Content-Length" ? "99" : null),
      },
      body: streamBody,
    } as unknown as Response);

    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll("/api/zip-len", {
      fallbackFilename: "x.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(streamBody.pipeTo).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(phases).toContain("saving");
    expect(phases.at(-1)).toBe("started");
    expect(click).toHaveBeenCalled();
  });

  it("falls back to native download when pipeTo fails", async () => {
    const phases: string[] = [];
    const remove = vi.fn().mockResolvedValue(undefined);
    const streamBody = {
      pipeTo: vi.fn().mockRejectedValue(new TypeError("network error")),
    };

    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ abort: vi.fn() }),
        remove,
      }),
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: streamBody,
    } as unknown as Response);

    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll("/api/zip-pipe", {
      fallbackFilename: "x.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(remove).toHaveBeenCalled();
    expect(phases.at(-1)).toBe("started");
    expect(click).toHaveBeenCalled();
  });
});
