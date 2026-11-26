import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchManutencaoHorario: vi.fn(),
  salvarManutencaoHorario: vi.fn(),
}));

vi.mock("@/api/manutencao", async (orig) => ({
  ...(await orig<typeof import("@/api/manutencao")>()),
  ...api,
}));

import { HorarioTrabalhoCard, resumoDias, resumoHorario } from "./HorarioTrabalhoCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HorarioTrabalhoCard />
    </QueryClientProvider>,
  );
}

describe("resumo do horário", () => {
  it("descreve os dias de forma curta", () => {
    expect(resumoDias([1, 2, 3, 4, 5])).toBe("Seg a Sex");
    expect(resumoDias([5, 1, 3])).toBe("Seg, Qua e Sex");
    expect(resumoDias([6])).toBe("Sáb");
    expect(resumoDias([1, 2, 3, 4, 5, 6, 7])).toBe("Todos os dias");
    expect(resumoDias([])).toBe("Nenhum dia");
  });

  it("inclui o intervalo ou o dia inteiro", () => {
    expect(resumoHorario({ dias: [1, 2, 3, 4, 5], inicio: "07:00", fim: "16:00" })).toBe("Seg a Sex, 07:00–16:00");
    expect(resumoHorario({ dias: [6, 7], inicio: "00:00", fim: "00:00" })).toBe("Sáb e Dom, dia inteiro");
  });
});

describe("HorarioTrabalhoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sem horário, oferece definir e salva dias e horas escolhidos", async () => {
    api.fetchManutencaoHorario.mockResolvedValue({
      ativo: false, dias: [1, 2, 3, 4, 5], inicio: "07:00", fim: "17:00", urgentes_fora: false, avisando_agora: true,
    });
    api.salvarManutencaoHorario.mockImplementation(async (b) => ({ ...b, avisando_agora: true }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Definir horário" }));

    fireEvent.click(screen.getByRole("button", { name: "Sexta" })); // desmarca sexta
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "16:30" } });
    fireEvent.click(screen.getByLabelText(/urgentes/));
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));

    await waitFor(() => expect(api.salvarManutencaoHorario).toHaveBeenCalled());
    expect(api.salvarManutencaoHorario.mock.calls[0]?.[0]).toEqual({
      ativo: true, dias: [1, 2, 3, 4], inicio: "08:00", fim: "16:30", urgentes_fora: true,
    });
  });

  it("não deixa salvar sem nenhum dia", async () => {
    api.fetchManutencaoHorario.mockResolvedValue({
      ativo: true, dias: [1], inicio: "07:00", fim: "17:00", urgentes_fora: false, avisando_agora: true,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Alterar" }));
    fireEvent.click(screen.getByRole("button", { name: "Segunda" }));
    expect(screen.getByText("Escolha ao menos um dia.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar/ })).toBeDisabled();
  });

  it("avisa quando está fora do horário agora", async () => {
    api.fetchManutencaoHorario.mockResolvedValue({
      ativo: true, dias: [1, 2, 3, 4, 5], inicio: "07:00", fim: "16:00", urgentes_fora: true, avisando_agora: false,
    });
    renderCard();
    expect(await screen.findByText(/Seg a Sex, 07:00–16:00/)).toBeInTheDocument();
    expect(screen.getByText(/Fora do horário agora/)).toHaveTextContent("exceto chamados urgentes");
  });

  it("explica o turno que atravessa a meia-noite", async () => {
    api.fetchManutencaoHorario.mockResolvedValue({
      ativo: true, dias: [1], inicio: "22:00", fim: "06:00", urgentes_fora: false, avisando_agora: true,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Alterar" }));
    expect(screen.getByText(/Turno da noite/)).toBeInTheDocument();
  });
});
