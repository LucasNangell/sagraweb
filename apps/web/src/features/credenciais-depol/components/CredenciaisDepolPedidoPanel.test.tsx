import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CredenciaisDepolPedidoPanel } from "./CredenciaisDepolPedidoPanel";
import type { CredenciaisDepolPedidoAdapters } from "./CredenciaisDepolPedidoPanel";

const DRAFT_KEY = "test.depol.draft";

const sample = {
  key: "1",
  modelo_arquivo: "a.jpg",
  linha1: "Deputado Teste",
  linha2: "",
  linha3: "",
};

function renderPanel(adapters: Partial<CredenciaisDepolPedidoAdapters> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const full: CredenciaisDepolPedidoAdapters = {
    queryKey: ["test-depol-modelos"],
    fetchModelos: async () => ({ modelos: [] }),
    createPedido: vi.fn(),
    thumbUrl: () => "/thumb.jpg",
    draftStorageKey: DRAFT_KEY,
    ...adapters,
  };
  return render(
    <QueryClientProvider client={client}>
      <CredenciaisDepolPedidoPanel adapters={full} />
    </QueryClientProvider>,
  );
}

describe("CredenciaisDepolPedidoPanel draft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restaura itens salvos no localStorage", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify([sample]));
    renderPanel();
    expect(await screen.findByText("Deputado Teste")).toBeInTheDocument();
    expect(screen.getByText(/Lista do pedido \(1\)/)).toBeInTheDocument();
  });

  it("usa o rascunho remoto quando a conta já tem itens", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify([sample]));
    renderPanel({
      fetchRemoteDraft: async () => ({
        itens: [{ ...sample, key: "r", linha1: "Salvo na conta" }],
      }),
      saveRemoteDraft: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByText("Salvo na conta")).toBeInTheDocument();
    });
    expect(screen.queryByText("Deputado Teste")).not.toBeInTheDocument();
  });
});
