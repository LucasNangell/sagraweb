import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

const statusResumo = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/api/papelaria", () => ({
  fetchPapelariaSpStatusResumo: vi.fn(async () => statusResumo),
}));

vi.mock("@/hooks/useSagraWebSocket", () => ({
  useSagraWebSocket: () => ({ status: "connected" }),
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

describe("PapelariaSpList colunas Prova/Imposição", () => {
  beforeEach(() => {
    localStorage.setItem(
      PAPELARIA_SP_SITUACOES_KEY,
      JSON.stringify(["Em execução"]),
    );
  });

  it("mostra o estado do servidor: prova aprovada e imposição pendente", async () => {
    statusResumo.items = [
      {
        ano: 2026,
        nro: 6100,
        prova: { phase: "approved", versao: 2, count: 2 },
        imposicao: { phase: "pending", job_id: null },
      },
    ];
    renderList();
    const prova = await screen.findByTestId("papelaria-sp-prova-6100");
    await waitFor(() =>
      expect(prova.querySelector('[data-icon="check"]')).not.toBeNull(),
    );
    expect(prova).toHaveTextContent("2");
    const imposicao = screen.getByTestId("papelaria-sp-imposicao-6100");
    expect(imposicao.querySelector('[data-icon="alert"]')).not.toBeNull();
  });

  it("mostra loading quando outro usuário está processando", async () => {
    statusResumo.items = [
      {
        ano: 2026,
        nro: 6100,
        prova: { phase: "approved", versao: 1 },
        imposicao: { phase: "processing", por: "123456" },
      },
    ];
    renderList();
    const imposicao = await screen.findByTestId("papelaria-sp-imposicao-6100");
    await waitFor(() =>
      expect(imposicao.querySelector('[data-icon="loader"]')).not.toBeNull(),
    );
    expect(imposicao.getAttribute("title")).toContain("123456");
  });
});

describe("PapelariaSpList coluna Tiragem", () => {
  beforeEach(() => {
    statusResumo.items = [];
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

  it("não embute tramitação na linha selecionada", () => {
    renderList(searchRow);
    expect(screen.getByTestId("papelaria-sp-situacao-6100")).toHaveTextContent(
      "Em execução",
    );
    expect(
      screen.queryByTestId("papelaria-sp-tramitacao-6100"),
    ).not.toBeInTheDocument();
  });
});
