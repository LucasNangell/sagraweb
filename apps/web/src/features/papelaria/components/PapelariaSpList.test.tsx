import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAPELARIA_SP_SITUACOES_KEY } from "../papelariaSpSituacoesPrefs";

vi.mock("@/api/hooks/useOsSearch", () => ({
  useOsSearch: () => ({
    data: {
      data: [
        {
          nr_os: 6100,
          ano: 2026,
          produto: "Timbrado",
          solicitante: "Fulano",
          tiragem: 1500,
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useSituacoesLookup: () => ({ data: ["Em execução"], isLoading: false }),
}));

vi.mock("@/api/papelaria", () => ({
  fetchPapelariaSpStatusResumo: vi.fn(async () => ({ items: [] })),
}));

import { PapelariaSpList } from "./PapelariaSpList";

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PapelariaSpList selected={null} onSelect={() => undefined} />
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
    const tiragem = headers.indexOf("Tiragem");
    const prova = headers.indexOf("Prova");
    expect(solicitante).toBeGreaterThanOrEqual(0);
    expect(tiragem).toBe(solicitante + 1);
    expect(prova).toBe(tiragem + 1);
    expect(screen.getByTestId("papelaria-sp-tiragem-6100")).toHaveTextContent(
      "1.500",
    );
  });
});
