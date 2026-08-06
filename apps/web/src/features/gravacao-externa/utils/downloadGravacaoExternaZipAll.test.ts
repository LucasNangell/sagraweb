import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { downloadGravacaoExternaZipAll } from "./downloadGravacaoExternaZipAll";

describe("downloadGravacaoExternaZipAll", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports preparing phase then throws on API error", async () => {
    const phases: string[] = [];
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
  });

  it("falls back to anchor download when File System Access is unavailable", async () => {
    const phases: string[] = [];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="pack.zip"',
        },
      }),
    );

    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") {
        el.click = click;
      }
      return el;
    });

    await downloadGravacaoExternaZipAll("/api/zip-url", {
      fallbackFilename: "x.zip",
      onPhase: (p) => phases.push(p),
    });

    expect(phases).toContain("preparing");
    expect(phases).toContain("started");
    expect(click).toHaveBeenCalled();
  });
});
