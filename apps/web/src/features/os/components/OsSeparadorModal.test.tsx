import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSeparadorCadernos, fetchSeparadorPdf } from "@/api/separador";
import {
  fetchLocalPrinters,
  printPdfLocally,
  SEPARADOR_PRINTER_STORAGE_KEY,
} from "@/lib/sagraLocalOpener";
import type { OsSearchRow } from "../types";
import { OsSeparadorModal } from "./OsSeparadorModal";

vi.mock("@/assets/camara-grafica-logo.png?inline", () => ({
  default: "logo.png",
}));

vi.mock("@/api/separador", () => ({
  fetchSeparadorPdf: vi.fn(async () => new Blob(["%PDF-1.4"], { type: "application/pdf" })),
  fetchSeparadorCadernos: vi.fn(async () => null),
}));

vi.mock("@/lib/sagraLocalOpener", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sagraLocalOpener")>();
  return {
    ...actual,
    fetchLocalPrinters: vi.fn(),
    printPdfLocally: vi.fn(),
  };
});

const row = {
  nr_os: 2532,
  ano: 2026,
  titulo: "Ata da sessão",
  solicitante: "Gabinete 12",
  produto: "Livro",
} as OsSearchRow;

describe("OsSeparadorModal", () => {
  beforeEach(() => {
    vi.mocked(fetchSeparadorPdf).mockClear();
    vi.mocked(fetchSeparadorCadernos).mockReset();
    vi.mocked(fetchSeparadorCadernos).mockResolvedValue(null);
    vi.mocked(printPdfLocally).mockReset();
    vi.mocked(fetchLocalPrinters).mockReset();
    vi.mocked(fetchLocalPrinters).mockResolvedValue({
      ok: true,
      printers: ["HP Separador", "Microsoft Print to PDF"],
      defaultPrinter: "HP Separador",
    });
    vi.mocked(printPdfLocally).mockResolvedValue({ ok: true });
    localStorage.removeItem(SEPARADOR_PRINTER_STORAGE_KEY);
  });

  it("preenche a OS e imprime o PDF 102x297 na fila local", async () => {
    render(<OsSeparadorModal row={row} open onClose={vi.fn()} />);

    expect(screen.getByTestId("os-separador-root")).toHaveTextContent(
      "OS 2532/2026",
    );
    const preview = screen.getByTestId("os-separador-preview");
    expect(preview.getAttribute("srcdoc")).toContain("2532/2026");
    expect(preview.getAttribute("srcdoc")).toContain("Ata da sessão");
    expect(preview.getAttribute("srcdoc")).toContain('data-cad="01"');

    const printerSelect = await screen.findByTestId("os-separador-printer");
    await waitFor(() => {
      expect(printerSelect).toHaveValue("HP Separador");
    });

    fireEvent.change(screen.getByTestId("os-separador-cad"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByTestId("os-separador-print"));

    await waitFor(() => {
      expect(fetchSeparadorPdf).toHaveBeenCalledWith({
        osLabel: "2532/2026",
        until: 3,
        titulo: "Ata da sessão",
        solicitante: "Gabinete 12",
        produto: "Livro",
      });
    });
    expect(printPdfLocally).toHaveBeenCalledWith({
      printer: "HP Separador",
      pdf: expect.any(Blob),
      widthMm: 102,
      heightMm: 297,
    });
    expect(localStorage.getItem(SEPARADOR_PRINTER_STORAGE_KEY)).toBe(
      "HP Separador",
    );
  });

  it("alerta se o caderno for inválido", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<OsSeparadorModal row={row} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("os-separador-print")).not.toBeDisabled();
    });
    fireEvent.change(screen.getByTestId("os-separador-cad"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByTestId("os-separador-print"));
    expect(alertSpy).toHaveBeenCalled();
    expect(fetchSeparadorPdf).not.toHaveBeenCalled();
    expect(printPdfLocally).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("mostra erro se o Folder Opener 1.2 não estiver no ar", async () => {
    vi.mocked(fetchLocalPrinters).mockResolvedValue({
      ok: false,
      error: "Folder Opener não está em execução neste computador (127.0.0.1:5566). Inicie a versão 1.2 ou superior.",
    });
    render(<OsSeparadorModal row={row} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("os-separador-opener-status")).toHaveTextContent(
        "Folder Opener",
      );
    });
    expect(screen.getByTestId("os-separador-print")).toBeDisabled();
  });

  it("preenche até o caderno pelos TIFFs da gravação", async () => {
    vi.mocked(fetchSeparadorCadernos).mockResolvedValue(4);
    render(<OsSeparadorModal row={row} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("os-separador-cad")).toHaveValue(4);
    });
    expect(screen.getByTestId("os-separador-root")).toHaveTextContent(
      "TIFFs da gravação",
    );
  });

  it("deixa o caderno em branco quando não há TIFFs com Cad N", async () => {
    render(<OsSeparadorModal row={row} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(fetchSeparadorCadernos).toHaveBeenCalledWith(2026, 2532);
    });
    expect(screen.getByTestId("os-separador-cad")).toHaveValue(null);
  });
});
