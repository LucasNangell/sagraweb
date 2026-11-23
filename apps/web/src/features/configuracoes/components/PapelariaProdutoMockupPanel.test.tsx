import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchPapelariaProdutoMockup: vi.fn(),
  savePapelariaProdutoMockup: vi.fn(),
  validatePapelariaAdminMockupConfig: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => api);
vi.mock("@/features/papelaria/components/PapelariaProofMockup3D", () => ({
  PapelariaProofMockup3D: () => <div data-testid="mockup-3d" />,
}));

import { PapelariaProdutoMockupPanel } from "./PapelariaProdutoMockupPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaProdutoMockupPanel
        produto="Ct Visita"
        modelos={[
          {
            id: 12,
            produto: "Ct Visita",
            frente_versao: "Frente e Verso",
            cores: "Policromia",
            arquivo_modelo: "CtVisitaFV.cdr",
            nome_exibicao: "Ct Visita FV",
            mockup_config_json_modelo: '{"modo":"cartao_frente_verso"}',
          },
        ]}
      />
    </QueryClientProvider>,
  );
}

describe("PapelariaProdutoMockupPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchPapelariaProdutoMockup.mockResolvedValue({
      produto: "Ct Visita",
      frente: '{"modo":"folha_simples"}',
      frente_verso: null,
    });
    api.savePapelariaProdutoMockup.mockImplementation(async (_p: string, v: string, j: string) => ({
      produto: "Ct Visita",
      frente: '{"modo":"folha_simples"}',
      frente_verso: v === "frente_verso" ? j : null,
    }));
  });

  it("edita cada variação do produto e migra o mockup antigo do modelo", async () => {
    renderPanel();
    const editor = await screen.findByLabelText("MockupConfigJson do produto");
    expect((editor as HTMLTextAreaElement).value).toContain("folha_simples");

    fireEvent.click(screen.getByRole("radio", { name: /Frente e verso/ }));
    const editorFv = screen.getByLabelText("MockupConfigJson do produto") as HTMLTextAreaElement;
    expect(editorFv.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Ct Visita FV/ }));
    expect(editorFv.value).toContain("cartao_frente_verso");

    fireEvent.click(screen.getByRole("button", { name: /Salvar no produto/ }));
    await vi.waitFor(() =>
      expect(api.savePapelariaProdutoMockup).toHaveBeenCalledWith(
        "Ct Visita",
        "frente_verso",
        expect.stringContaining("cartao_frente_verso"),
      ),
    );
  });
});


describe("PapelariaProdutoMockupPanel · herdado", () => {
  it("mostra o mockup herdado de um modelo excluído e salva no produto", async () => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchPapelariaProdutoMockup.mockResolvedValue({
      produto: "Ct Visita",
      frente: null,
      frente_verso: '{"id":"cartao_visita_frente_verso_flip","modo":"cartao_simples"}',
      salvo: { frente: false, frente_verso: false },
      herdado: { frente: null, frente_verso: { modelo_id: 12, arquivo: "CtVisitaFV.cdr", ativo: false } },
    });
    api.savePapelariaProdutoMockup.mockResolvedValue({
      produto: "Ct Visita",
      frente: null,
      frente_verso: '{"id":"cartao_visita_frente_verso_flip","modo":"cartao_simples"}',
      salvo: { frente: false, frente_verso: true },
      herdado: { frente: null, frente_verso: null },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("radio", { name: /Frente e verso/ }));
    expect(screen.getByText(/Herdado de CtVisitaFV.cdr \(modelo excluído\)/)).toBeInTheDocument();
    expect((screen.getByLabelText("MockupConfigJson do produto") as HTMLTextAreaElement).value).toContain(
      "cartao_visita_frente_verso_flip",
    );
    expect(screen.getByText(/salve para fixar no produto/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Salvar no produto/ }));
    await vi.waitFor(() =>
      expect(api.savePapelariaProdutoMockup).toHaveBeenCalledWith("Ct Visita", "frente_verso", expect.stringContaining("flip")),
    );
    expect(await screen.findByText("Configurado no produto")).toBeInTheDocument();
  });
});
