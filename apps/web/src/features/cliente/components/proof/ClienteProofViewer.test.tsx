import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClienteProofViewer } from "./ClienteProofViewer";

describe("ClienteProofViewer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock-pdf"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carrega PDF via fetch e exibe iframe com blob URL (sem URL direta da API)", async () => {
    render(
      <ClienteProofViewer
        pdfUrl="/sagra/api/client/proof/2026/5946/pdf?token=abc"
        osLabel="5946/26"
        hasPdf
        arquivoNome="prova_v1.pdf"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Prova 5946/26")).toHaveAttribute(
        "src",
        "blob:mock-pdf",
      );
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/sagra/api/client/proof/2026/5946/pdf?token=abc",
      { credentials: "include" },
    );
    expect(screen.getByText(/Visualização da prova/i)).toBeInTheDocument();
  });

  it("no portal ajusta zoom page-fit por padrão quando fillHeight", async () => {
    render(
      <ClienteProofViewer
        pdfUrl="/sagra/api/client/proof/2026/5946/pdf?token=abc"
        osLabel="5946/26"
        hasPdf
        fillHeight
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Prova 5946/26")).toHaveAttribute(
        "src",
        "blob:mock-pdf#page=1&zoom=page-fit",
      );
    });
  });

  it("usa zoom page-height para produtos retrato", async () => {
    render(
      <ClienteProofViewer
        pdfUrl="/sagra/api/client/proof/2026/5946/pdf?token=abc"
        osLabel="5946/26"
        hasPdf
        fillHeight
        pdfFit="height"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Prova 5946/26")).toHaveAttribute(
        "src",
        "blob:mock-pdf#page=1&zoom=page-height",
      );
    });
  });

  it("usa zoom page-width para produtos paisagem", async () => {
    render(
      <ClienteProofViewer
        pdfUrl="/sagra/api/client/proof/2026/5946/pdf?token=abc"
        osLabel="5946/26"
        hasPdf
        fillHeight
        pdfFit="width"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Prova 5946/26")).toHaveAttribute(
        "src",
        "blob:mock-pdf#page=1&zoom=page-width",
      );
    });
  });

  it("exibe estado indisponível quando não há PDF", () => {
    render(
      <ClienteProofViewer
        pdfUrl="/sagra/api/client/proof/2026/5946/pdf?token=abc"
        osLabel="5946/26"
        hasPdf={false}
      />,
    );

    expect(
      screen.getByText(/Prova ainda não disponível/i),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Prova 5946/26")).not.toBeInTheDocument();
  });
});
