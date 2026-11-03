import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/authStore";

import { SettingsModal } from "./SettingsModal";

vi.mock("@/api/hooks/useOsFilterOptions", () => ({
  useOsFilterYears: () => ({ data: { data: [2026] }, isLoading: false }),
  useOsFilterProducts: () => ({ data: { data: [] }, isFetching: false }),
  useOsFilterRequesters: () => ({ data: { data: [] }, isFetching: false }),
}));

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useCategoriasLookup: () => ({ data: ["Deputado"], isLoading: false }),
  useMaquinasLookup: () => ({ data: ["Komori"], isLoading: false }),
  useSetoresLookup: () => ({ data: ["SEFOC"], isLoading: false }),
  useSituacoesLookup: () => ({
    data: Array.from({ length: 18 }, (_, i) => `Situação ${i + 1}`),
    isLoading: false,
  }),
}));

vi.mock("@/api/hooks/useSavedFilters", () => ({
  useSavedFilters: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock("@/api/settings", () => ({
  createSavedFilter: vi.fn(),
  deleteSavedFilter: vi.fn(),
  setDefaultSavedFilter: vi.fn(),
  updateSavedFilter: vi.fn(),
}));

function renderModal() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsModal open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("SettingsModal filter layout", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { ponto: 918713, nome: "Teste", ip: "127.0.0.1" },
      isAuthenticated: true,
    });
  });

  it("mostra cada rótulo de filtro uma vez e placeholders completos", () => {
    renderModal();

    for (const label of [
      "Nr OS/Ano:",
      "Processo:",
      "Categoria:",
      "Nome:",
      "Título:",
      "Máquina:",
      "Produto:",
      "Prioridade:",
      "Setor:",
      "Situação:",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.getAllByText("Todos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selecione...").length).toBeGreaterThan(0);
    expect(screen.queryByText("TMaquina:")).not.toBeInTheDocument();
  });
});
