import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectNetworkFiles } from "./networkFiles";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), apiUrl: (path: string) => path }));
const mockedFetch = vi.mocked(apiFetch);
const files = (size: number) => Array.from({ length: size }, (_, i) => ({
  absolute_path: `X:/plate-${i}.tif`, nome: `plate-${i}.tif`, maquina: "KOMORI",
}));
const resultFor = (options?: RequestInit) => ({ files: JSON.parse(String(options?.body)).files.map((file: object) => ({
  ...file, type: "tif", status: "done", blank_graphics: true, preview_mime: "image/png",
})) });

describe("inspeção progressiva", () => {
  beforeEach(() => { mockedFetch.mockReset(); });

  it("processa 300 arquivos com no máximo dois em voo e progresso individual", async () => {
    let inFlight = 0;
    let maximum = 0;
    mockedFetch.mockImplementation(async (_path, options) => {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      inFlight--;
      return resultFor(options);
    });
    const progress = vi.fn();
    const response = await inspectNetworkFiles(files(300), { onProgress: progress });
    expect(response.files).toHaveLength(300);
    expect(maximum).toBe(2);
    expect(mockedFetch).toHaveBeenCalledTimes(300);
    expect(progress.mock.calls.map(call => call[0].files.length)).toEqual(Array.from({ length: 301 }, (_, i) => i));
    expect(new Set(response.files.map(file => file.absolute_path)).size).toBe(300);
  });

  it("cancela os envios restantes e ignora respostas tardias", async () => {
    mockedFetch.mockImplementation(async (_path, options) => {
      await Promise.resolve();
      return resultFor(options);
    });
    const controller = new AbortController();
    const progress = vi.fn(result => { if (result.files.length === 1) controller.abort(); });
    await expect(inspectNetworkFiles(files(300), { signal: controller.signal, onProgress: progress })).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledTimes(2); // vazio + um resultado
    expect(mockedFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("não inicia chamadas se já estiver cancelado", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(inspectNetworkFiles(files(300), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("deduplica por arquivo e máquina, mantendo contextos distintos", async () => {
    mockedFetch.mockImplementation(async (_path, options) => resultFor(options));
    const first = files(1)[0]!;
    const response = await inspectNetworkFiles([first, { ...first, maquina: " komori " }, { ...first, maquina: "SM74" }]);
    expect(response.files).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("para a fila quando a API falha", async () => {
    mockedFetch.mockRejectedValue(new Error("API indisponível"));
    await expect(inspectNetworkFiles(files(300))).rejects.toThrow("API indisponível");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
