import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { perfilVazio } from "@/features/papelaria/imposicao/perfil/perfilUtils";

const api = vi.hoisted(() => ({
  fetchPerfisProduto: vi.fn(),
  salvarPerfil: vi.fn(),
  validarPerfil: vi.fn(),
  ativarPerfil: vi.fn(),
  compararPerfil: vi.fn(),
  fetchModelosPerfil: vi.fn(),
  fetchPdfInfo: vi.fn(),
  pdfThumbUrl: vi.fn(() => "/thumb"),
  removerModeloPerfil: vi.fn(),
  removerPerfil: vi.fn(),
  salvarModeloPerfil: vi.fn(),
  enviarMarcasPdf: vi.fn(),
  importarMarcasPdf: vi.fn(),
  fetchMarcasArquivoInfo: vi.fn(),
  marcasPdfUrl: vi.fn((a: string) => `/marcas/${a}`),
  marcasThumbUrl: vi.fn((a: string) => `/marcas/${a}/thumb`),
}));
vi.mock("@/api/imposicaoPerfil", () => api);
vi.mock("@/api/auxLookups", () => ({ fetchSituacoes: vi.fn(async () => ["Aguard. Juntada"]) }));
vi.mock("./PapelariaModeloImposicaoPanel", () => ({ PapelariaModeloImposicaoPanel: () => null }));

import { PerfilImposicaoPanel } from "./PerfilImposicaoPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PerfilImposicaoPanel produto="Produto X" modelo={null} produtos={["Produto X", "Produto Y"]} />
    </QueryClientProvider>,
  );
}

const antigo = perfilVazio();
antigo.folha = { largura_mm: 297, altura_mm: 210 };
antigo.pagina = { fonte: "fixa", largura_mm: 148, altura_mm: 210 };
antigo.grade = { ...antigo.grade, colunas: 2 };
antigo.slots.frente = [
  { id: 1, col: 0, row: 0, pagina: 1, rotacao: 0 },
  { id: 2, col: 1, row: 0, pagina: 1, rotacao: 0 },
];

describe("PerfilImposicaoPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => "mockReset" in fn && fn.mockReset());
    api.marcasPdfUrl.mockImplementation((a: string) => `/marcas/${a}`);
    api.marcasThumbUrl.mockImplementation((a: string) => `/marcas/${a}/thumb`);
    api.pdfThumbUrl.mockImplementation(() => "/thumb");
    api.fetchModelosPerfil.mockResolvedValue([]);
    api.validarPerfil.mockResolvedValue({ erros: [], avisos: [], completo: true, perfil: null, resumo: null });
    api.fetchPerfisProduto.mockResolvedValue({
      produto: "Produto X",
      digital: null,
      offset: null,
      configuracao_antiga: {
        digital: { existe: true, perfil: antigo, completo_no_banco: true },
        offset: { existe: false, perfil: null, completo_no_banco: false },
      },
    });
  });

  it("mostra o estado e permite importar a configuração atual para o editor", async () => {
    renderPanel();
    expect(await screen.findByText(/Hoje a imposição digital deste produto usa a configuração antiga/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Importar da configuração atual/ }));
    expect(screen.getByText("1. Folha")).toBeInTheDocument();
    expect(screen.getByText("7. Saída")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /7\. Saída/ }));
    expect(screen.getByLabelText(/Pasta de saída do PDF imposto/)).toBeInTheDocument();
    expect(screen.getByTestId("perfil-imposicao-preview")).toBeInTheDocument();
    expect(screen.getAllByText("297×210 mm · 2 slots").length).toBeGreaterThan(0);
  });

  it("salva o rascunho da variante selecionada", async () => {
    api.salvarPerfil.mockResolvedValue({
      id: 1,
      produto: "Produto X",
      variante: "digital",
      perfil: antigo,
      ativo: false,
      validacao: { erros: [], avisos: [], completo: true },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Importar da configuração atual/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));
    await waitFor(() => expect(api.salvarPerfil).toHaveBeenCalledWith("Produto X", "digital", antigo));
  });
});

describe("PerfilImposicaoPanel — PDF de marcas no servidor", () => {
  beforeEach(() => {
    api.fetchModelosPerfil.mockResolvedValue([]);
    api.validarPerfil.mockResolvedValue({ erros: [], avisos: [], completo: true, perfil: null, resumo: null });
    api.fetchPerfisProduto.mockResolvedValue({
      produto: "Produto X",
      digital: null,
      offset: null,
      configuracao_antiga: {
        digital: { existe: true, perfil: antigo, completo_no_banco: true },
        offset: { existe: false, perfil: null, completo_no_banco: false },
      },
    });
  });

  it("envia o PDF escolhido ao servidor e o perfil passa a usar o arquivo guardado", async () => {
    const meta = {
      arquivo: "0123456789abcdef_Marcas.pdf",
      nome_original: "Marcas.pdf",
      paginas: 1,
      largura_mm: 297,
      altura_mm: 210,
    };
    api.enviarMarcasPdf.mockResolvedValue(meta);
    api.fetchMarcasArquivoInfo.mockResolvedValue({ ...meta, existe: true });
    api.salvarPerfil.mockResolvedValue({
      id: 1, produto: "Produto X", variante: "digital", perfil: antigo, ativo: false,
      validacao: { erros: [], avisos: [], completo: true },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Importar da configuração atual/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Usar PDF de marcas/ }));
    const file = new File([new Uint8Array([37, 80, 68, 70])], "Marcas.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("marcas-pdf-input"), { target: { files: [file] } });
    await waitFor(() => expect(api.enviarMarcasPdf).toHaveBeenCalledWith(file));
    expect(await screen.findByText("Marcas.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/marcas/0123456789abcdef_Marcas.pdf");
    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));
    await waitFor(() =>
      expect(api.salvarPerfil).toHaveBeenCalledWith(
        "Produto X",
        "digital",
        expect.objectContaining({
          marcas: expect.objectContaining({ ativo: true, arquivo: meta.arquivo, pdf_path: null }),
        }),
      ),
    );
  });
});

describe("PerfilImposicaoPanel — frente e verso com PDF incompleto", () => {
  beforeEach(() => {
    api.fetchModelosPerfil.mockResolvedValue([]);
    api.validarPerfil.mockResolvedValue({ erros: [], avisos: [], completo: true, perfil: null, resumo: null });
    api.fetchPerfisProduto.mockResolvedValue({
      produto: "Produto X",
      digital: null,
      offset: null,
      configuracao_antiga: {
        digital: { existe: true, perfil: antigo, completo_no_banco: true },
        offset: { existe: false, perfil: null, completo_no_banco: false },
      },
    });
  });

  it("em frente e verso oferece gerar com menos páginas (ligado por padrão) e salva a escolha", async () => {
    api.salvarPerfil.mockResolvedValue({
      id: 1, produto: "Produto X", variante: "digital", perfil: antigo, ativo: false,
      validacao: { erros: [], avisos: [], completo: true },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Importar da configuração atual/ }));
    const opcao = /Gerar mesmo quando o PDF da OS vier com menos páginas/;
    expect(screen.queryByRole("checkbox", { name: opcao })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: /Impressão/ }), { target: { value: "frente_verso" } });
    const toggle = screen.getByRole("checkbox", { name: opcao });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/o JDF sai só frente/)).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));
    await waitFor(() =>
      expect(api.salvarPerfil).toHaveBeenCalledWith(
        "Produto X",
        "digital",
        expect.objectContaining({ faces: "frente_verso", paginas_faltantes: "erro" }),
      ),
    );
  });
});
