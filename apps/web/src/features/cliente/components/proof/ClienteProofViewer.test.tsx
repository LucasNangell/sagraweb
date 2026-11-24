import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orientacao = vi.hoisted(() => ({ lerOrientacaoPdf: vi.fn() }));
vi.mock("@/lib/pdfOrientacao", () => orientacao);

import { ClienteProofViewer } from "./ClienteProofViewer";

describe("ClienteProofViewer", () => {
  beforeEach(() => {
    orientacao.lerOrientacaoPdf.mockReset();
    orientacao.lerOrientacaoPdf.mockResolvedValue(null);
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
        "blob:mock-pdf#navpanes=0&pagemode=none",
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
        "blob:mock-pdf#page=1&view=Fit&zoom=page-fit&navpanes=0&pagemode=none",
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
        "blob:mock-pdf#page=1&view=FitV&zoom=page-height&navpanes=0&pagemode=none",
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
        "blob:mock-pdf#page=1&view=FitH&zoom=page-width&navpanes=0&pagemode=none",
      );
    });
  });

  it("orientação lida do PDF vence o ajuste do produto", async () => {
    orientacao.lerOrientacaoPdf.mockResolvedValue("paisagem");
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
        "blob:mock-pdf#page=1&view=FitH&zoom=page-width&navpanes=0&pagemode=none",
      );
    });
    expect(orientacao.lerOrientacaoPdf).toHaveBeenCalledWith("blob:mock-pdf");
  });

  it("PDF em pé abre ajustado à altura", async () => {
    orientacao.lerOrientacaoPdf.mockResolvedValue("retrato");
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
        "blob:mock-pdf#page=1&view=FitV&zoom=page-height&navpanes=0&pagemode=none",
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
