import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pdfOrientacao", () => ({
  usePdfOrientacao: () => ({ orientacao: null, pronta: true }),
}));

import type { PapelariaViewMode } from "../papelariaViewMode";
import type { PapelariaProvaStatus } from "../types";
import { PapelariaProofPanel } from "./PapelariaProofPanel";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

function renderPainel(opts: {
  viewMode: PapelariaViewMode;
  provaStatus?: PapelariaProvaStatus | null;
  criarProva?: { onClick: () => void; disabled: boolean; pending: boolean } | null;
  arquivo?: string;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaProofPanel
        activeJob={null}
        isJobGenerating={false}
        produto="Ct Visita"
        previa={null}
        selectedModelId={null}
        modelLoading={false}
        viewMode={opts.viewMode}
        onViewModeChange={() => {}}
        folderProofPdfUrl="/api/email/os/2026/5954/proof-file?filename=x.pdf"
        folderProofLabel={opts.arquivo ?? "05954-Ana-Prova2.pdf"}
        provaStatus={opts.provaStatus ?? null}
        criarProva={opts.criarProva ?? null}
      />
    </QueryClientProvider>,
  );
}

describe("PapelariaProofPanel — aprovação da prova", () => {
  it("prova aprovada pelo cliente: badge verde «Aprovada» ao lado da versão", () => {
    renderPainel({ viewMode: "prova", provaStatus: { phase: "approved", versao: 2 } });
    expect(screen.getByTestId("papelaria-prova-version-badge")).toHaveTextContent("Prova 2");
    const badge = screen.getByTestId("papelaria-prova-aprovacao-badge");
    expect(badge).toHaveTextContent("Aprovada");
    expect(badge).toHaveAttribute("data-aprovada", "true");
  });

  it("aprovação de uma versão anterior não vale para a prova nova", () => {
    renderPainel({ viewMode: "prova", provaStatus: { phase: "approved", versao: 1 } });
    expect(screen.getByTestId("papelaria-prova-aprovacao-badge")).toHaveTextContent("Pendente de aprovação");
  });

  it("sem aprovação: badge âmbar «Pendente de aprovação»", () => {
    renderPainel({ viewMode: "prova", provaStatus: { phase: "waiting_client", versao: 2 } });
    const badge = screen.getByTestId("papelaria-prova-aprovacao-badge");
    expect(badge).toHaveTextContent("Pendente de aprovação");
    expect(badge).toHaveAttribute("data-aprovada", "false");
  });
});

describe("PapelariaProofPanel — «Criar prova» flutuante", () => {
  it("aparece na prévia e dispara a criação", () => {
    const onClick = vi.fn();
    renderPainel({ viewMode: "previa", criarProva: { onClick, disabled: false, pending: false } });
    fireEvent.click(screen.getByTestId("papelaria-criar-prova-flutuante"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respeita o bloqueio e some fora da prévia", () => {
    const { unmount } = renderPainel({
      viewMode: "previa",
      criarProva: { onClick: vi.fn(), disabled: true, pending: false },
    });
    expect(screen.getByTestId("papelaria-criar-prova-flutuante")).toBeDisabled();
    unmount();
    renderPainel({ viewMode: "prova", criarProva: { onClick: vi.fn(), disabled: false, pending: false } });
    expect(screen.queryByTestId("papelaria-criar-prova-flutuante")).not.toBeInTheDocument();
  });
});
