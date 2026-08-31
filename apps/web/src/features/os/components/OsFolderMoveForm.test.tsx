import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OsFolderMoveForm } from "./OsFolderMoveForm";

const previewOsFolderMove = vi.fn();
const executeOsFolderMove = vi.fn();

vi.mock("@/api/os", () => ({
  previewOsFolderMove: (...args: unknown[]) => previewOsFolderMove(...args),
  executeOsFolderMove: (...args: unknown[]) => executeOsFolderMove(...args),
}));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OsFolderMoveForm
        destAno={2026}
        destId={3100}
        variant="repeticao"
        defaultOrigemNumero="2282"
        defaultOrigemAno="25"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("OsFolderMoveForm", () => {
  beforeEach(() => {
    previewOsFolderMove.mockReset();
    executeOsFolderMove.mockReset();
  });

  it("avisa e exige confirmação quando a origem não está concluída", async () => {
    previewOsFolderMove.mockResolvedValue({
      dest_solicitante: "A",
      dest_produto: "Cartao",
      origem_solicitante: "A",
      origem_produto: "Cartao",
      same_solicitante: true,
      same_produto: true,
      meta_mismatch: false,
      origem_folder_exists: true,
      origem_folder_path: "\\\\rede\\origem",
      dest_folder_exists: false,
      dest_folder_path: "",
      folders_to_move: [{ from_name: "Original", to_name: "25 02282 Original" }],
      dest_conflicts: [],
      can_execute: true,
      origem_situacao: "Em Execução",
      origem_concluida: false,
      origem_andamentos: [
        {
          situacao: "Entrada Inicial",
          setor: "SEFOC",
          data: "2026-01-10",
          ponto: "123",
          observacao: null,
        },
        {
          situacao: "Em Execução",
          setor: "SEFOC",
          data: "2026-01-12",
          ponto: "123",
          observacao: null,
        },
      ],
    });

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Conferir" }));

    expect(
      await screen.findByText("Esta OS ainda não foi concluída"),
    ).toBeInTheDocument();
    expect(screen.getByText("Em Execução", { selector: "td" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mover pastas" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText(
        "Confirmo a transferência de arquivos desta OS ainda não concluída",
      ),
    );
    expect(screen.getByRole("button", { name: "Mover pastas" })).toBeEnabled();
  });
});
