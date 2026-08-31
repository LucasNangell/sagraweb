import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ETAPAS_PANEL_COPY, ProdutoEtapasPanel } from "./ProdutoEtapasPanel";

const fetchAcabamentoPassos = vi.fn();

vi.mock("@/api/adminSystem", () => ({
  fetchProdutoPassos: vi.fn(),
  saveProdutoPassos: vi.fn(),
  copyProdutoPassos: vi.fn(),
  fetchAcabamentoPassos: (...args: unknown[]) => fetchAcabamentoPassos(...args),
  saveAcabamentoPassos: vi.fn(),
  copyAcabamentoPassos: vi.fn(),
}));

function renderAcabamento() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProdutoEtapasPanel catalogId={30} rotulo="Laminação" variant="acabamento" />
    </QueryClientProvider>,
  );
}

describe("ProdutoEtapasPanel acabamento", () => {
  beforeEach(() => {
    fetchAcabamentoPassos.mockReset();
    fetchAcabamentoPassos.mockResolvedValue({
      passos: [],
      funcoes: [],
      setores: ["SEPAC"],
      produtos: [],
      acabamentos: [{ id: 90, label: "Grampo" }],
    });
  });

  it("mostra Tempo e mão de obra no item de acabamento", async () => {
    renderAcabamento();
    expect(await screen.findByText(ETAPAS_PANEL_COPY.acabamento.title)).toBeInTheDocument();
    expect(screen.getByText(ETAPAS_PANEL_COPY.acabamento.empty)).toBeInTheDocument();
    expect(screen.queryByText(ETAPAS_PANEL_COPY.produto.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Espera do cliente (R$ 0)")).not.toBeInTheDocument();
  });
});
