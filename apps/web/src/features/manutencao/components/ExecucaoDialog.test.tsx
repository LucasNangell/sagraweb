import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ManutencaoPedido } from "@/api/manutencao";

const api = vi.hoisted(() => ({
  fetchManutencaoPedido: vi.fn(),
  salvarProgressoManutencao: vi.fn(),
  pausarManutencaoPedido: vi.fn(),
  concluirManutencaoPedido: vi.fn(),
  devolverManutencaoPedido: vi.fn(),
  iniciarManutencaoPedido: vi.fn(),
}));

vi.mock("@/api/manutencao", async (orig) => ({
  ...(await orig<typeof import("@/api/manutencao")>()),
  ...api,
}));
vi.mock("./SolucoesHistorico", () => ({
  SimilaresPanel: () => null,
  HistoricoBuscaDialog: () => null,
}));

import { ExecucaoDialog } from "./ExecucaoDialog";

const PEDIDO: ManutencaoPedido = {
  id: 7,
  maquina_id: 1,
  maquina_nome: "Guilhotina A",
  maquina_codigo: "MAQ-0002",
  titulo: "Trocar lâmina",
  prioridade: "normal",
  status: "em_execucao",
  maquina_parada: false,
  solicitado_por: "1",
  iniciado_por: "918713",
  solucao_passos: [],
  eventos: [],
};

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExecucaoDialog pedidoId={7} ponto="918713" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const campoNovoPasso = () => screen.getByPlaceholderText(/Descreva o próximo passo/);

describe("ExecucaoDialog — passos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchManutencaoPedido.mockResolvedValue(PEDIDO);
    api.salvarProgressoManutencao.mockResolvedValue(PEDIDO);
    api.pausarManutencaoPedido.mockResolvedValue({ ...PEDIDO, status: "pausado" });
  });

  it("não mostra o aviso de lista vazia", async () => {
    renderDialog();
    await screen.findByPlaceholderText(/Descreva o próximo passo/);
    expect(screen.queryByText(/Nenhum passo registrado/)).toBeNull();
  });

  it("ao concluir, o passo digitado entra na lista sem clicar em Adicionar", async () => {
    renderDialog();
    fireEvent.change(await screen.findByPlaceholderText(/Descreva o próximo passo/), {
      target: { value: "Soltar os parafusos da lâmina" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Concluir serviço/ }));
    expect(screen.getByLabelText("Passo 1")).toHaveValue("Soltar os parafusos da lâmina");
    expect(campoNovoPasso()).toHaveValue("");
    expect(screen.queryByText(/Registre ao menos um passo/)).toBeNull();
  });

  it("ao pausar, salva também o passo digitado", async () => {
    renderDialog();
    fireEvent.change(await screen.findByPlaceholderText(/Descreva o próximo passo/), {
      target: { value: "Aguardar lâmina nova" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Pausar$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aguardando peça" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar pausa/ }));
    await waitFor(() => expect(api.pausarManutencaoPedido).toHaveBeenCalledWith(7, "Aguardando peça"));
    expect(api.salvarProgressoManutencao).toHaveBeenCalledWith(7, {
      diagnostico: "",
      passos: ["Aguardar lâmina nova"],
    });
  });
});
