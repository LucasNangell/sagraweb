import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchProvaPdfModelo: vi.fn(),
  saveProvaPdfCampos: vi.fn(),
  uploadProvaPdfModelo: vi.fn(),
  previaProvaPdf: vi.fn(),
  deleteProvaPdfModelo: vi.fn(),
}));
vi.mock("@/api/papelariaProvaPdf", () => api);
vi.mock("@/api/adminSystem", () => ({
  fetchPapelariaVariaveis: vi.fn().mockResolvedValue({ variaveis: [], reservadas: [] }),
}));
vi.mock("@/api/papelaria", () => ({
  fetchPapelariaCorelModelo: vi.fn().mockResolvedValue({ campos_formulario: [] }),
}));
vi.mock("./PapelariaBlocoRedesCard", () => ({ PapelariaBlocoRedesCard: () => null }));

import { PapelariaModeloProvaPdfPanel } from "./PapelariaModeloProvaPdfPanel";

const texto = (marcador: string, y_mm: number) => ({
  marcador,
  pagina: 1,
  fonte: "Stone",
  tamanho: 10,
  cor: "#000",
  x_mm: 20,
  y_mm,
  alinhamento_sugerido: "centro",
  ancora_sugerida: "topo",
});

describe("PapelariaModeloProvaPdfPanel — grupos de campos", () => {
  it("cria um grupo pelos campos, ajusta o alinhamento do grupo e salva junto", async () => {
    const modelo = {
      tem_pdf: true,
      arquivo: "m.pdf",
      campos: [
        { marcador: "NOME", pagina: 1, template: "{nome}", alinhamento: "auto", ancora: "auto", entrelinha: 1.2, reduzir_para_caber: true },
        { marcador: "CARGO", pagina: 1, template: "{cargo}", alinhamento: "auto", ancora: "auto", entrelinha: 1.2, reduzir_para_caber: true },
      ],
      grupos: [],
      analise: { paginas: [], fontes: [], textos: [texto("NOME", 30), texto("CARGO", 35)] },
    };
    api.fetchProvaPdfModelo.mockResolvedValue(modelo);
    api.saveProvaPdfCampos.mockResolvedValue(modelo);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PapelariaModeloProvaPdfPanel
          modelo={{ id: 7, produto: "Ct Visita", frente_versao: "Frente", cores: "", arquivo_modelo: "m.pdf", nome_exibicao: "M" }}
        />
      </QueryClientProvider>,
    );
    const grupoNome = await screen.findByLabelText("Grupo de NOME");
    fireEvent.change(grupoNome, { target: { value: "__novo" } });
    const cartao = await screen.findByTestId("papelaria-prova-pdf-grupos");
    expect(cartao).toHaveTextContent("NOME");
    // Segundo campo entra no mesmo grupo.
    const opcoes = Array.from((screen.getByLabelText("Grupo de CARGO") as HTMLSelectElement).options).map((o) => o.value);
    const gid = opcoes.find((v) => v.startsWith("g"))!;
    fireEvent.change(screen.getByLabelText("Grupo de CARGO"), { target: { value: gid } });
    fireEvent.change(screen.getByLabelText("Alinhamento vertical de Grupo 1"), { target: { value: "base" } });
    fireEvent.change(screen.getByLabelText("Alinhamento horizontal de Grupo 1"), { target: { value: "centro" } });
    expect(cartao).toHaveTextContent("NOME · CARGO");

    fireEvent.click(screen.getByTestId("papelaria-prova-pdf-salvar"));
    await waitFor(() => expect(api.saveProvaPdfCampos).toHaveBeenCalled());
    const [, campos, opts] = api.saveProvaPdfCampos.mock.calls[0]!;
    expect(campos.map((c: { grupo?: string }) => c.grupo)).toEqual([gid, gid]);
    expect(opts.grupos).toEqual([{ id: gid, nome: "Grupo 1", ancora: "base", alinhamento: "centro" }]);
  });
});
