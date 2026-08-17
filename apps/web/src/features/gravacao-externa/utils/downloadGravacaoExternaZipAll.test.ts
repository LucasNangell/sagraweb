import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/api/gravacaoExterna", () => ({
  startGravacaoExternaZip: vi.fn(),
  getGravacaoExternaZipStatus: vi.fn(),
  gravacaoExternaZipDownloadUrl: (ano: number, nrOs: number) =>
    `/api/gravacao-externa/${ano}/${nrOs}/arquivos/zip/download`,
}));

import {
  getGravacaoExternaZipStatus,
  startGravacaoExternaZip,
} from "@/api/gravacaoExterna";

import { downloadGravacaoExternaZipAll } from "./downloadGravacaoExternaZipAll";

const startZip = vi.mocked(startGravacaoExternaZip);
const getZipStatus = vi.mocked(getGravacaoExternaZipStatus);

function readyJob(overrides: Record<string, unknown> = {}) {
  return {
    status: "pronto",
    assinatura: "abc",
    nome_arquivo: "x.zip",
    tamanho_bytes: 8,
    total_arquivos: 2,
    arquivos_prontos: 2,
    bytes_prontos: 8,
    erro: null,
    etag: '"abc"',
    ...overrides,
  };
}

describe("downloadGravacaoExternaZipAll", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "showSaveFilePicker");
    startZip.mockReset();
    getZipStatus.mockReset();
    startZip.mockResolvedValue(readyJob());
    getZipStatus.mockResolvedValue(readyJob());
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

  it("reports preparing then throws on job error", async () => {
    const phases: string[] = [];
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ abort: vi.fn(), write: vi.fn(), close: vi.fn() }),
        remove: vi.fn(),
      }),
    });
    startZip.mockResolvedValue({
      ...readyJob(),
      status: "erro",
      erro: "Arquivo não encontrado: a.tif",
    });

    await expect(
      downloadGravacaoExternaZipAll({
        ano: 2024,
        nrOs: 1805,
        fallbackFilename: "x.zip",
        pollIntervalMs: 0,
        onPhase: (p) => phases.push(p),
      }),
    ).rejects.toThrow(/Arquivo não encontrado/);

    expect(phases[0]).toBe("preparing");
    expect(phases.at(-1)).toBe("error");
  });

  it("goes to native download of the ready ZIP when File System Access is unavailable", async () => {
    const phases: string[] = [];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll({
      ano: 2024,
      nrOs: 77,
      fallbackFilename: "x.zip",
      pollIntervalMs: 0,
      onPhase: (p) => phases.push(p),
    });

    expect(startZip).toHaveBeenCalledWith(2024, 77);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(phases).toContain("preparing");
    expect(phases.at(-1)).toBe("started");
    expect(click).toHaveBeenCalled();
  });

  it("calls showSaveFilePicker before starting the ZIP job", async () => {
    const order: string[] = [];
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        order.push("picker");
        return {
          createWritable: vi.fn().mockResolvedValue({
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        };
      }),
    });
    startZip.mockImplementation(async () => {
      order.push("job-started");
      return readyJob({ tamanho_bytes: 4 });
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Content-Range": "bytes 0-3/4",
          ETag: '"abc"',
        },
      }),
    );

    await downloadGravacaoExternaZipAll({
      ano: 2024,
      nrOs: 1,
      fallbackFilename: "pack.zip",
      pollIntervalMs: 0,
      chunkSize: 16,
    });

    expect(order[0]).toBe("picker");
    expect(order.indexOf("picker")).toBeLessThan(order.indexOf("job-started"));
  });

  it("retries a failed Range chunk and keeps the offset", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write, close }),
      }),
    });
    startZip.mockResolvedValue(readyJob({ tamanho_bytes: 4 }));

    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("upstream request timeout", { status: 504 });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Range": "bytes 0-3/4", ETag: '"abc"' },
      });
    });

    await downloadGravacaoExternaZipAll({
      ano: 2024,
      nrOs: 1,
      fallbackFilename: "x.zip",
      pollIntervalMs: 0,
      chunkSize: 16,
      chunkTimeoutMs: 1_000,
      maxChunkRetries: 3,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    expect(calls).toBe(2);
  });

  it("returns idle when the abort signal fires during polling", async () => {
    const phases: string[] = [];
    startZip.mockResolvedValue({
      ...readyJob(),
      status: "gerando",
      tamanho_bytes: null,
    });
    getZipStatus.mockResolvedValue({
      ...readyJob(),
      status: "gerando",
      tamanho_bytes: null,
    });
    const controller = new AbortController();
    const pending = downloadGravacaoExternaZipAll({
      ano: 2024,
      nrOs: 1,
      fallbackFilename: "x.zip",
      pollIntervalMs: 20,
      signal: controller.signal,
      onPhase: (p) => phases.push(p),
    });
    controller.abort();
    await pending;
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
    const click = mockAnchorClick();

    await downloadGravacaoExternaZipAll({
      ano: 2024,
      nrOs: 1,
      fallbackFilename: "x.zip",
      pollIntervalMs: 0,
      onPhase: (p) => phases.push(p),
    });

    expect(startZip).toHaveBeenCalled();
    expect(phases).toContain("started");
    expect(click).toHaveBeenCalled();
  });
});
