import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAPELARIA_SP_SITUACOES_KEY } from "../papelariaSpSituacoesPrefs";

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

vi.mock("@/api/hooks/useOsSearch", () => ({
  useOsSearch: () => ({
    data: { data: [searchRow] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useSituacoesLookup: () => ({ data: ["Em execução"], isLoading: false }),
  useSetoresLookup: () => ({ data: ["SEFOC"], isLoading: false }),
}));

vi.mock("@/api/papelaria", () => ({
  fetchPapelariaSpStatusResumo: vi.fn(async () => ({ items: [] })),
}));

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
  formatUsuarioPontoLabel: (ponto?: string | null, nome?: string | null) =>
    [ponto, nome].filter(Boolean).join(" "),
  OsAndamentoEditor: () => (
    <div>
      <button type="button" title="Excluir andamento selecionado">
        Excluir
      </button>
      <button type="button">Novo</button>
      <button type="button">Editar</button>
    </div>
  ),
}));

import { PapelariaSpList } from "./PapelariaSpList";

function renderList(selected: typeof searchRow | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PapelariaSpList selected={selected} onSelect={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("PapelariaSpList coluna Tiragem", () => {
  beforeEach(() => {
    localStorage.setItem(
      PAPELARIA_SP_SITUACOES_KEY,
      JSON.stringify(["Em execução"]),
    );
  });

  it("mostra Tiragem entre Solicitante e Prova", () => {
    renderList();
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    const solicitante = headers.indexOf("Solicitante");
    const situacao = headers.indexOf("Situação");
    const tiragem = headers.indexOf("Tiragem");
    const prova = headers.indexOf("Prova");
    expect(solicitante).toBeGreaterThanOrEqual(0);
    expect(situacao).toBe(solicitante + 1);
    expect(tiragem).toBe(situacao + 1);
    expect(prova).toBe(tiragem + 1);
    expect(screen.getByTestId("papelaria-sp-tiragem-6100")).toHaveTextContent(
      "1.500",
    );
    expect(screen.getByTestId("papelaria-sp-situacao-6100")).toHaveTextContent(
      "Em execução",
    );
  });

  it("mostra o andamento atual e expande o último com observação e botões", () => {
    renderList(searchRow);
    expect(screen.getByTestId("papelaria-sp-situacao-6100")).toHaveTextContent(
      "Em execução",
    );
    expect(screen.queryByTestId("papelaria-sp-andamento-atual-6100")).not.toBeInTheDocument();
    expect(screen.getByTestId("papelaria-sp-obs-6100")).toHaveTextContent(
      "Aguardando prova",
    );
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("papelaria-sp-andamento-6100-1"));
    expect(screen.getByTestId("papelaria-sp-obs-6100")).toHaveTextContent(
      "Primeira observação",
    );
  });
});
