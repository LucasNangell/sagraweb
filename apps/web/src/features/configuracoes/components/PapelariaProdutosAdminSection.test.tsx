import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

const api = vi.hoisted(() => ({
  fetchPapelariaAdminModelos: vi.fn(),
  fetchImposicaoStatus: vi.fn(),
  savePapelariaAdminModeloPadrao: vi.fn(),
  removerPapelariaModeloFace: vi.fn(),
}));

vi.mock("@/api/adminSystem", () => ({
  fetchPapelariaAdminModelos: api.fetchPapelariaAdminModelos,
  savePapelariaAdminModeloPadrao: api.savePapelariaAdminModeloPadrao,
  removerPapelariaModeloFace: api.removerPapelariaModeloFace,
}));
vi.mock("@/api/imposicaoPerfil", () => ({ fetchImposicaoStatus: api.fetchImposicaoStatus }));

// Painéis pesados: só registramos qual foi montado e com qual modelo/produto.
vi.mock("./PapelariaModeloDadosPanel", () => ({
  PapelariaModeloDadosPanel: ({ modelo }: { modelo: PapelariaAdminModelRecord }) => (
    <div data-testid="panel-dados">dados:{modelo.id}</div>
  ),
}));
vi.mock("./PapelariaProdutoMockupPanel", () => ({
  PapelariaProdutoMockupPanel: ({ produto }: { produto: string }) => (
    <div data-testid="panel-mockup">mockup:{produto}</div>
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
  PapelariaNovoModeloForm: ({ lockedProduto, faceInicial }: { lockedProduto?: string; faceInicial?: string }) => (
    <div data-testid="novo-modelo-form">
      {lockedProduto ?? "novo-produto"}|{faceInicial ?? "-"}
    </div>
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

    // O modelo frente e verso aparece nas duas colunas (frente e verso).
    const frentes = screen.getByTestId("pw-face-col-frente");
    const versos = screen.getByTestId("pw-face-col-verso");
    expect(within(versos).getByText("Cartão de visita 2")).toBeInTheDocument();
    expect(within(versos).queryByText("Cartão de visita 1")).not.toBeInTheDocument();
    fireEvent.click(within(frentes).getByText("Cartão de visita 2"));
    // Mockup 3D é do produto, não do modelo.
    expect(screen.queryByRole("tab", { name: /Mockup 3D/ })).not.toBeInTheDocument();

    // Prévia ao vivo + Prova PDF agora são uma aba só.
    expect(screen.queryByRole("tab", { name: /Prova PDF/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Textos e prévia/ }));
    expect(screen.getByTestId("panel-textos")).toHaveTextContent("textos:2");

    fireEvent.click(screen.getByRole("radio", { name: /Mockup 3D/ }));
    expect(screen.getByTestId("panel-mockup")).toHaveTextContent("mockup:Cartão de visita");

    fireEvent.click(screen.getByRole("radio", { name: /Imposição/ }));
    expect(screen.getByTestId("panel-imposicao")).toHaveTextContent("imposicao:Cartão de visita");
    expect(screen.queryByRole("tab", { name: /Textos e prévia/ })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Novo verso/ }));
    expect(screen.getByTestId("novo-modelo-form")).toHaveTextContent("Cartão de visita|verso");

    fireEvent.click(screen.getAllByRole("button", { name: /Novo produto/ })[0]!);
    expect(screen.getByTestId("novo-modelo-form")).toHaveTextContent("novo-produto");
  });

  it("separa frentes e versos por perfil de cores, cada um com seu padrão", async () => {
    api.fetchPapelariaAdminModelos.mockResolvedValue([
      modelo(1, "Cartão de visita", { cores: "Policromia" }),
      modelo(4, "Cartão de visita", { cores: "Relev Seco", padrao_frente: true }),
      modelo(5, "Cartão de visita", { cores: "Relev Seco", frente_versao: "Verso" }),
    ]);
    renderSection();
    await screen.findByTestId("panel-dados");
    const frentes = screen.getByTestId("pw-face-col-frente");
    const versos = screen.getByTestId("pw-face-col-verso");
    expect(within(frentes).getByText("Policromia")).toBeInTheDocument();
    expect(within(frentes).getByText("Relev Seco")).toBeInTheDocument();
    // Policromia ainda sem frente padrão; Relev Seco já tem.
    expect(within(frentes).getAllByText("sem padrão")).toHaveLength(1);
    expect(within(versos).getByText(/Nenhum verso em Policromia/)).toBeInTheDocument();
    expect(within(versos).getByText("Cartão de visita 5")).toBeInTheDocument();
    expect(screen.queryByText("Combinado")).not.toBeInTheDocument();
  });

  it("remove só o verso de um modelo de 2 páginas e esconde a face removida", async () => {
    api.removerPapelariaModeloFace.mockResolvedValue({ excluido: false, modelo_id: 2 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();
    await screen.findByTestId("panel-dados");
    const versos = screen.getByTestId("pw-face-col-verso");
    fireEvent.click(within(versos).getByRole("button", { name: /Remover o verso Cartão de visita 2/ }));
    expect(confirm.mock.calls[0]![0]).toMatch(/a frente continua/);
    await vi.waitFor(() => expect(api.removerPapelariaModeloFace).toHaveBeenCalledWith(2, "verso"));
    confirm.mockRestore();
  });

  it("não lista a face já removida", async () => {
    api.fetchPapelariaAdminModelos.mockResolvedValue([
      modelo(2, "Cartão de visita", { frente_versao: "Frente e Verso", ocultar_verso: true }),
    ]);
    renderSection();
    await screen.findByTestId("panel-dados");
    expect(within(screen.getByTestId("pw-face-col-verso")).queryByText("Cartão de visita 2")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("pw-face-col-frente")).getByText("Cartão de visita 2")).toBeInTheDocument();
  });

  it("define a frente padrão pela estrela do card", async () => {
    api.savePapelariaAdminModeloPadrao.mockResolvedValue({});
    renderSection();
    await screen.findByTestId("panel-dados");
    const frentes = screen.getByTestId("pw-face-col-frente");
    fireEvent.click(within(frentes).getByRole("button", { name: /Definir Cartão de visita 1 como frente padrão/ }));
    await vi.waitFor(() =>
      expect(api.savePapelariaAdminModeloPadrao).toHaveBeenCalledWith(1, "frente", true),
    );
  });
});
