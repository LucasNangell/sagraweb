import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchPapelariaVariaveis: vi.fn(),
  savePapelariaVariaveis: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => api);

import { PapelariaVariaveisSection } from "./PapelariaVariaveisSection";

const cadastro = {
  variaveis: [
    { chave: "nome_deputado", rotulo: "Nome do deputado/deputada", fonte: "deputado_nome", tipo: "text", obrigatorio: true },
    { chave: "nome_assessor", rotulo: "Nome do assessor", fonte: null, tipo: "text", obrigatorio: false },
  ],
  fontes: [
    { id: "deputado_nome", rotulo: "Nome parlamentar do deputado", grupo: "Deputado", exemplo: "Maria Silva" },
    { id: "gabinete_numero", rotulo: "Número do gabinete", grupo: "Gabinete", exemplo: "123" },
  ],
  reservadas: ["artigo", "genero_curto"],
  uso: { nome_deputado: 4, orgao: 2 },
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaVariaveisSection />
    </QueryClientProvider>,
  );
}

describe("PapelariaVariaveisSection", () => {
  beforeEach(() => {
    api.fetchPapelariaVariaveis.mockReset();
    api.savePapelariaVariaveis.mockReset();
    api.fetchPapelariaVariaveis.mockResolvedValue(cadastro);
    api.savePapelariaVariaveis.mockImplementation(async (variaveis: unknown) => ({ ...cadastro, variaveis }));
  });

  it("edita rótulo e preenchimento, com 'Informado pelo usuário'", async () => {
    renderSection();
    const linha = await screen.findByTestId("pw-var-nome_assessor");
    const preenchimento = within(linha).getByLabelText("Preenchimento de nome_assessor") as HTMLSelectElement;
    expect(preenchimento.value).toBe("");
    expect(within(preenchimento).getByRole("option", { name: "Informado pelo usuário" })).toBeInTheDocument();

    fireEvent.change(within(linha).getByLabelText("Rótulo de nome_assessor"), { target: { value: "Assessor(a)" } });
    fireEvent.change(preenchimento, { target: { value: "gabinete_numero" } });
    expect(within(linha).getByText("Ex.: 123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    await vi.waitFor(() => expect(api.savePapelariaVariaveis).toHaveBeenCalled());
    expect(api.savePapelariaVariaveis.mock.calls[0]![0][1]).toEqual({
      chave: "nome_assessor",
      rotulo: "Assessor(a)",
      fonte: "gabinete_numero",
      tipo: "text",
      obrigatorio: false,
    });
  });

  it("oferece cadastrar variáveis usadas nos PDFs e valida o nome", async () => {
    renderSection();
    const pendentes = await screen.findByTestId("pw-vars-nao-cadastradas");
    fireEvent.click(within(pendentes).getByRole("button", { name: /\{orgao\}/ }));
    expect(screen.getByTestId("pw-var-orgao")).toBeInTheDocument();
    expect((screen.getAllByLabelText(/Rótulo de/).at(-1) as HTMLInputElement).value).toBe("Orgao");

    fireEvent.click(screen.getByRole("button", { name: "Nova variável" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    expect(await screen.findByText(/Nome de variável inválido/)).toBeInTheDocument();
    expect(api.savePapelariaVariaveis).not.toHaveBeenCalled();
  });
});
