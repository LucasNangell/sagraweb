import { afterEach, describe, expect, it, vi } from "vitest";

import { blobToBase64, fetchLocalPrinters, printPdfLocally } from "./sagraLocalOpener";

describe("sagraLocalOpener print", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lista impressoras em 127.0.0.1:5566", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          printers: ["HP Separador"],
          default: "HP Separador",
        }),
      })),
    );
    await expect(fetchLocalPrinters()).resolves.toEqual({
      ok: true,
      printers: ["HP Separador"],
      defaultPrinter: "HP Separador",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:5566/printers",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("pede atualização quando a rota de impressão ainda não existe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })),
    );
    const result = await fetchLocalPrinters();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/versão 1\.2/i);
    }
  });

  it("envia o PDF em base64 para a fila local", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("http://127.0.0.1:5566/print-pdf");
      const body = JSON.parse(String(init?.body)) as {
        printer: string;
        pdf_base64: string;
        width_mm: number;
        height_mm: number;
      };
      expect(body.printer).toBe("HP Separador");
      expect(body.width_mm).toBe(102);
      expect(body.height_mm).toBe(297);
      expect(atob(body.pdf_base64)).toBe("%PDF-1.4");
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    await expect(
      printPdfLocally({ printer: "HP Separador", pdf, widthMm: 102, heightMm: 297 }),
    ).resolves.toEqual({ ok: true });
  });

  it("converte blob para base64", async () => {
    await expect(blobToBase64(new Blob(["%PDF"]))).resolves.toBe(btoa("%PDF"));
  });
});
