import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

const api = vi.hoisted(() => ({
  fetchPapelariaAdminModelos: vi.fn(),
  fetchImposicaoStatus: vi.fn(),
}));

vi.mock("@/api/adminSystem", () => ({ fetchPapelariaAdminModelos: api.fetchPapelariaAdminModelos }));
vi.mock("@/api/imposicaoPerfil", () => ({ fetchImposicaoStatus: api.fetchImposicaoStatus }));

// Painéis pesados: só registramos qual foi montado e com qual modelo/produto.
vi.mock("./PapelariaModeloDadosPanel", () => ({
  PapelariaModeloDadosPanel: ({ modelo }: { modelo: PapelariaAdminModelRecord }) => (
    <div data-testid="panel-dados">dados:{modelo.id}</div>
  ),
}));
vi.mock("./PapelariaModeloMockupPanel", () => ({
  PapelariaModeloMockupPanel: ({ modelo }: { modelo: PapelariaAdminModelRecord }) => (
    <div data-testid="panel-mockup">mockup:{modelo.id}</div>
  ),
}));
vi.mock("./PapelariaModeloTextosPanel", () => ({
  PapelariaModeloTextosPanel: ({ modelo }: { modelo: PapelariaAdminModelRecord }) => (
    <div data-testid="panel-textos">textos:{modelo.id}</div>
  ),
}));
vi.mock("./PerfilImposicaoPanel", () => ({
  PerfilImposicaoPanel: ({ produto }: { produto: string }) => (
    <div data-testid="panel-imposicao">imposicao:{produto}</div>
  ),
}));
vi.mock("./PapelariaNovoModeloForm", () => ({
  PapelariaNovoModeloForm: ({ lockedProduto }: { lockedProduto?: string }) => (
    <div data-testid="novo-modelo-form">{lockedProduto ?? "novo-produto"}</div>
  ),
}));

import { PapelariaProdutosAdminSection } from "./PapelariaProdutosAdminSection";

function modelo(id: number, produto: string, extra: Partial<PapelariaAdminModelRecord> = {}): PapelariaAdminModelRecord {
  return {
    id,
    produto,
    frente_versao: "Frente",
    cores: "Policromia",
    arquivo_modelo: `C:\\Modelos\\${produto}-${id}.cdr`,
    nome_exibicao: `${produto} ${id}`,
    ...extra,
  };
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaProdutosAdminSection />
    </QueryClientProvider>,
  );
}

describe("PapelariaProdutosAdminSection", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    api.fetchPapelariaAdminModelos.mockResolvedValue([
      modelo(1, "Cartão de visita", { tem_mockup_config: true, tem_preview_config: true }),
      modelo(2, "Cartão de visita", { frente_versao: "Frente e Verso" }),
      modelo(3, "Envelope"),
    ]);
    api.fetchImposicaoStatus.mockResolvedValue({
      "Cartão de visita": { digital: { existe: true, ativo: true } },
    });
  });

  it("seleciona o primeiro produto/modelo e mostra o resumo do catálogo", async () => {
    renderSection();
    expect(await screen.findByTestId("panel-dados")).toHaveTextContent("dados:1");
    expect(screen.getByText("2 produtos · 3 modelos Corel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Cartão de visita" })).toBeInTheDocument();
  });

  it("filtra produtos pela busca (sem acentos) e troca de produto", async () => {
    renderSection();
    await screen.findByTestId("panel-dados");
    const nav = screen.getByRole("complementary", { name: "Produtos" });

    fireEvent.change(within(nav).getByRole("searchbox"), { target: { value: "cartao" } });
    expect(within(nav).queryByText("Envelope")).not.toBeInTheDocument();

    fireEvent.change(within(nav).getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(within(nav).getByText("Envelope"));
    expect(await screen.findByText("dados:3")).toBeInTheDocument();
  });

  it("alterna entre modelos, abas do modelo e o escopo de imposição do produto", async () => {
    renderSection();
    await screen.findByTestId("panel-dados");

    fireEvent.click(screen.getByRole("button", { name: /Frente e Verso · Policromia/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Mockup 3D/ }));
    expect(screen.getByTestId("panel-mockup")).toHaveTextContent("mockup:2");

    // Prévia ao vivo + Prova PDF agora são uma aba só.
    expect(screen.queryByRole("tab", { name: /Prova PDF/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Textos e prévia/ }));
    expect(screen.getByTestId("panel-textos")).toHaveTextContent("textos:2");

    fireEvent.click(screen.getByRole("radio", { name: /Imposição/ }));
    expect(screen.getByTestId("panel-imposicao")).toHaveTextContent("imposicao:Cartão de visita");
    expect(screen.queryByRole("tab", { name: /Mockup 3D/ })).not.toBeInTheDocument();
  });

  it("leva a aba antiga salva na sessão (Prova PDF) para Textos e prévia", async () => {
    window.sessionStorage.setItem(
      "sagra:config:papelaria-produtos",
      JSON.stringify({ produto: "Envelope", modeloId: 3, tab: "prova-pdf", scope: "modelos" }),
    );
    renderSection();
    expect(await screen.findByTestId("panel-textos")).toHaveTextContent("textos:3");
  });

  it("abre os formulários de novo produto e novo modelo", async () => {
    renderSection();
    await screen.findByTestId("panel-dados");

    fireEvent.click(screen.getByRole("button", { name: /Novo modelo/ }));
    expect(screen.getByTestId("novo-modelo-form")).toHaveTextContent("Cartão de visita");

    fireEvent.click(screen.getAllByRole("button", { name: /Novo produto/ })[0]);
    expect(screen.getByTestId("novo-modelo-form")).toHaveTextContent("novo-produto");
  });
});
