import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OsVinculosEditor } from "./OsVinculosEditor";
import type { OsSearchRow } from "../types";

const fetchOsVinculos = vi.fn();
const fetchOsVinculoGrupoConfig = vi.fn();
const createOsVinculo = vi.fn();
const updateOsVinculoGrupoAndamentos = vi.fn();
const deleteOsVinculo = vi.fn();
const fetchProtocoloLookup = vi.fn();

vi.mock("@/api/os", () => ({
  fetchOsVinculos: (...args: unknown[]) => fetchOsVinculos(...args),
  fetchOsVinculoGrupoConfig: (...args: unknown[]) =>
    fetchOsVinculoGrupoConfig(...args),
  createOsVinculo: (...args: unknown[]) => createOsVinculo(...args),
  updateOsVinculoGrupoAndamentos: (...args: unknown[]) =>
    updateOsVinculoGrupoAndamentos(...args),
  deleteOsVinculo: (...args: unknown[]) => deleteOsVinculo(...args),
}));

vi.mock("@/api/email", () => ({
  fetchProtocoloLookup: (...args: unknown[]) => fetchProtocoloLookup(...args),
}));

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useSituacoesLookup: () => ({
    data: ["Recebido", "Saída p/", "Em Execução"],
  }),
  useSetoresLookup: () => ({
    data: ["SEFOC", "SEIMP", "SEGRA"],
  }),
}));

vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { ponto: number } }) => unknown) =>
    sel({ user: { ponto: 1234 } }),
}));

const row: OsSearchRow = { nr_os: 100, ano: 2026 };

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OsVinculosEditor row={row} />
    </QueryClientProvider>,
  );
}

describe("OsVinculosEditor", () => {
  beforeEach(() => {
    fetchOsVinculos.mockReset();
    fetchOsVinculoGrupoConfig.mockReset();
    createOsVinculo.mockReset();
    updateOsVinculoGrupoAndamentos.mockReset();
    deleteOsVinculo.mockReset();
    fetchProtocoloLookup.mockReset();
    fetchOsVinculos.mockResolvedValue([]);
    fetchOsVinculoGrupoConfig.mockResolvedValue({ membros: [] });
  });

  it("permite adicionar mais de um par andamento+setor", async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId("os-vincular-andamento-0")).toBeInTheDocument();
      expect(screen.getByText("Nenhuma vinculação.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("os-vincular-andamento-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("os-vincular-add-andamento"));
    expect(screen.getByTestId("os-vincular-andamento-1")).toBeInTheDocument();
    const andamentoSelects = screen.getAllByLabelText(/Andamento/);
    expect(andamentoSelects).toHaveLength(2);
    expect(andamentoSelects[0]).not.toBeDisabled();
    expect(andamentoSelects[1]).not.toBeDisabled();
  });

  it("não trava os pares depois que o grupo já existe", async () => {
    fetchOsVinculos.mockResolvedValue([{ numero: 200, ano: 2026 }]);
    fetchOsVinculoGrupoConfig.mockResolvedValue({
      grupo_id: 9,
      situacao: "Recebido",
      setor: "SEFOC",
      membros: [
        { numero: 100, ano: 2026 },
        { numero: 200, ano: 2026 },
      ],
      andamentos: [
        { situacao: "Recebido", setor: "SEFOC" },
        { situacao: "Saída p/", setor: "SEIMP" },
      ],
    });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId("os-vincular-andamento-1")).toBeInTheDocument();
    });
    const andamentoSelects = screen.getAllByLabelText(/Andamento/);
    expect(andamentoSelects).toHaveLength(2);
    for (const select of andamentoSelects) {
      expect(select).not.toBeDisabled();
    }
    expect(screen.getByTestId("os-vincular-save-andamentos")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("os-vincular-add-andamento"));
    expect(screen.getByTestId("os-vincular-andamento-2")).toBeInTheDocument();
  });
});
