import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/authStore";
import { defaultOsFilters, useOsFiltersStore } from "../osFiltersStore";
import { OsSaveCurrentFiltersModal } from "./OsSaveCurrentFiltersModal";

const createSavedFilter = vi.fn();

vi.mock("@/api/settings", () => ({
  createSavedFilter: (...args: unknown[]) => createSavedFilter(...args),
}));

function renderModal(
  onSaved = vi.fn(),
  onClose = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    onSaved,
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <OsSaveCurrentFiltersModal open onClose={onClose} onSaved={onSaved} />
      </QueryClientProvider>,
    ),
  };
}

describe("OsSaveCurrentFiltersModal", () => {
  beforeEach(() => {
    createSavedFilter.mockReset();
    createSavedFilter.mockResolvedValue({ status: "success" });
    useAuthStore.setState({
      user: { ponto: 1234, nome: "Ana", ip: "127.0.0.1" },
    });
    useOsFiltersStore.setState({
      filters: {
        ...defaultOsFilters(),
        situacao: ["Em Andamento"],
        setor: ["Arte"],
        anos: [2026],
        processo: "12.345",
        titulo: "Obra",
      },
    });
  });

  it("não chama a API com nome vazio", async () => {
    const { onSaved } = renderModal();
    fireEvent.click(screen.getByTestId("os-save-filters-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Digite um nome para o filtro.",
    );
    expect(createSavedFilter).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("envia o payload dos filtros atuais ao salvar", async () => {
    const { onSaved, onClose } = renderModal();
    fireEvent.change(screen.getByTestId("os-save-filters-name"), {
      target: { value: "  Produção Arte  " },
    });
    fireEvent.click(screen.getByTestId("os-save-filters-submit"));

    await waitFor(() => {
      expect(createSavedFilter).toHaveBeenCalledTimes(1);
    });
    expect(createSavedFilter.mock.calls[0][0]).toEqual({
      usuario: "Ana",
      ponto: "1234",
      nome: "Produção Arte",
      situacoes: ["Em Andamento"],
      setores: ["Arte"],
      criterios: {
        nr_os: null,
        anos: [2026],
        processo: "12345",
        categorias: [],
        solicitantes: [],
        titulo: "Obra",
        produtos: [],
        maquinas: [],
        prioridade: [],
      },
    });
    expect(onSaved).toHaveBeenCalledWith("Produção Arte");
    expect(onClose).toHaveBeenCalled();
  });
});
