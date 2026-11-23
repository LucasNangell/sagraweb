import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

const api = vi.hoisted(() => ({ fetchProvaPdfModelo: vi.fn() }));
vi.mock("@/api/papelariaProvaPdf", () => api);
vi.mock("./PapelariaModeloProvaPdfPanel", () => ({
  PapelariaModeloProvaPdfPanel: () => <div data-testid="panel-pdf" />,
}));
vi.mock("./PapelariaModeloPreviewPanel", () => ({
  PapelariaModeloPreviewPanel: () => <div data-testid="panel-imagem" />,
}));

import { PapelariaModeloTextosPanel } from "./PapelariaModeloTextosPanel";

const base: PapelariaAdminModelRecord = {
  id: 5,
  produto: "Bloco",
  frente_versao: "Frente",
  cores: "Policromia",
  arquivo_modelo: "Bloco.cdr",
  nome_exibicao: "Bloco",
};

function renderPanel(modelo: PapelariaAdminModelRecord) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaModeloTextosPanel modelo={modelo} />
    </QueryClientProvider>,
  );
}

describe("PapelariaModeloTextosPanel", () => {
  beforeEach(() => api.fetchProvaPdfModelo.mockReset());

  it("com PDF do modelo, usa o PDF como fonte única", async () => {
    api.fetchProvaPdfModelo.mockResolvedValue({
      tem_pdf: true,
      campos: [{ marcador: "X", pagina: 1, template: "{nome_deputado}" }],
      analise: null,
    });
    renderPanel({ ...base, tem_preview_config: true });
    expect(await screen.findByText("PDF do modelo em uso")).toBeInTheDocument();
    expect(screen.getByTestId("panel-pdf")).toBeInTheDocument();
  });

  it("sem PDF e com prévia antiga, mostra o legado e recomenda o PDF", async () => {
    api.fetchProvaPdfModelo.mockResolvedValue({ tem_pdf: false, campos: [], analise: null });
    renderPanel({ ...base, tem_preview_config: true });
    expect(await screen.findByText("Prévia por imagem (legado)")).toBeInTheDocument();
    expect(screen.getByTestId("panel-imagem")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configurar PDF do modelo" }));
    expect(screen.getByTestId("panel-pdf")).toBeInTheDocument();
  });
});
