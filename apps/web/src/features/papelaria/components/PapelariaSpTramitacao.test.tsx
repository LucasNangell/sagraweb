import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const searchRow = {
  nr_os: 6100,
  ano: 2026,
  produto: "Timbrado",
  solicitante: "Fulano",
  tiragem: 1500,
  situacao: "Em execução",
  setor: "SEFOC",
  last_update: "2026-11-18",
  andamento_ponto: "918713",
};

vi.mock("@/api/hooks/useOsHistory", () => ({
  useOsHistory: () => ({
    data: [
      {
        CodStatus: "1",
        SituacaoLink: "Recebido",
        SetorLink: "SEFOC",
        Data: "2026-11-01",
        Ponto: "111111",
        usuario_nome: "Ana",
        Observaçao: "Primeira observação",
      },
      {
        CodStatus: "2",
        SituacaoLink: "Em execução",
        SetorLink: "SEFOC",
        Data: "2026-11-18",
        Ponto: "918713",
        usuario_nome: "Paulo",
        Observaçao: "Aguardando prova",
      },
    ],
    isPending: false,
    isFetching: false,
  }),
}));

vi.mock("@/features/os/components/OsAndamentoEditor", () => ({
  OsAndamentoEditor: ({
    historyRow,
    compact,
    presentation,
  }: {
    historyRow: { Observaçao?: string | null } | null;
    compact?: boolean;
    presentation?: string;
  }) => (
    <div
      data-testid="papelaria-sp-andamento-editor"
      data-compact={compact ? "true" : "false"}
      data-presentation={presentation ?? ""}
    >
      <span data-testid="papelaria-sp-obs-6100">
        {historyRow?.Observaçao?.trim() || "Sem observação."}
      </span>
      <button type="button" title="Excluir andamento selecionado">
        Excluir
      </button>
      <button type="button">Novo</button>
      <button type="button">Editar</button>
    </div>
  ),
}));

import { PapelariaSpTramitacao } from "./PapelariaSpTramitacao";

function renderTramitacao(row: typeof searchRow | null = searchRow) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PapelariaSpTramitacao row={row} />
    </QueryClientProvider>,
  );
}

describe("PapelariaSpTramitacao layout fixo", () => {
  it("mostra placeholder sem SP selecionada", () => {
    renderTramitacao(null);
    expect(screen.getByTestId("papelaria-sp-tramitacao-empty")).toHaveTextContent(
      "Selecione uma SP na lista para ver o histórico.",
    );
  });

  it("lista só Situação e Setor e mostra campos no editor compacto", () => {
    renderTramitacao();
    expect(screen.getByTestId("papelaria-sp-tramitacao-6100")).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Situação", "Setor"]);

    const lastRow = screen.getByTestId("papelaria-sp-andamento-6100-2");
    expect(lastRow).toHaveTextContent("Em execução");
    expect(lastRow).toHaveTextContent("SEFOC");
    expect(lastRow).not.toHaveTextContent("18/11/2026");
    expect(lastRow).not.toHaveTextContent("918713");

    const editor = screen.getByTestId("papelaria-sp-andamento-editor");
    expect(editor).toHaveAttribute("data-compact", "true");
    expect(editor).toHaveAttribute("data-presentation", "panel");
    expect(screen.getByTestId("papelaria-sp-obs-6100")).toHaveTextContent(
      "Aguardando prova",
    );
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
  });

  it("troca a observação ao selecionar outro andamento", () => {
    renderTramitacao();
    fireEvent.click(screen.getByTestId("papelaria-sp-andamento-6100-1"));
    expect(screen.getByTestId("papelaria-sp-obs-6100")).toHaveTextContent(
      "Primeira observação",
    );
  });
});
