import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FluxoProducaoResponse } from "@/api/osFluxoProducao";

import { ProducaoGanttFullPage } from "./ProducaoGanttFullPage";
import { ProducaoGanttPanel } from "./ProducaoGanttPanel";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/features/configuracoes/hooks/useDevFeature", () => ({
  useDevFeature: () => true,
}));

const fluxoData: FluxoProducaoResponse = {
  resumo: {
    os: { nr_os: 1392, ano: 2026, produto: "Folder" },
    status_geral: "atrasada",
    agora: "2026-06-15T12:20:00",
    desvio_total_min: 50,
    etapa_atual: { id: "x", rotulo: "Preparação - corte", setor: "SEPAC" },
    pausa_cliente: { ativa: false },
    previsao_termino: "2026-06-15T17:50:00",
    previsao_termino_baseline: "2026-06-15T17:00:00",
    confianca: "media",
    amostras: 12,
    escala: "horas",
    janela: {
      inicio: "2026-06-15T08:00:00",
      fim: "2026-06-15T18:00:00",
    },
    tick_min: 60,
    expediente: { abertura_hora: 6, fechamento_hora: 22 },
    inicio_producao_em: "2026-06-15T08:00:00",
    avisos: ["Previsão baseada apenas em OS a partir de 2024"],
  },
  etapas: [
    {
      id: "1",
      ordem: 10,
      rotulo: "Pré-impressão",
      setor: "SEFOC",
      tipo: "produtiva",
      previsto_inicio: "2026-06-15T08:00:00",
      previsto_fim: "2026-06-15T09:00:00",
      previsto_duracao_min: 60,
      real_inicio: "2026-06-15T08:00:00",
      real_fim: "2026-06-15T08:50:00",
      status: "concluido",
      medicao: "inferida",
    },
    {
      id: "2",
      ordem: 20,
      rotulo: "Preparação - corte",
      setor: "SEPAC",
      tipo: "produtiva",
      previsto_inicio: "2026-06-15T09:00:00",
      previsto_fim: "2026-06-15T10:00:00",
      previsto_duracao_min: 60,
      real_inicio: "2026-06-15T09:10:00",
      real_fim: null,
      status: "em_execucao",
      progresso_pct: 45,
      progresso_estimado: true,
      medicao: "inferida",
    },
  ],
};

vi.mock("@/features/os/hooks/useOsFluxoProducao", () => ({
  useOsFluxoProducao: () => ({
    query: {
      isPending: false,
      isError: false,
      data: fluxoData,
    },
    agoraLocal: "2026-06-15T12:20:00",
  }),
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ProducaoGanttPanel", () => {
  beforeEach(() => {
    navigate.mockReset();
  });
  it("renderiza cabeçalho e etapas do cenário com atraso", () => {
    wrap(<ProducaoGanttPanel ano={2026} osId={1392} enabled />);
    expect(screen.getByText(/Fluxo de Produção/i)).toBeInTheDocument();
    expect(screen.getByText(/50 min atrasado/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Preparação - corte/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Em execução/i).length).toBeGreaterThan(0);
  });

  it("Ver tudo navega para a página em tela cheia", () => {
    wrap(<ProducaoGanttPanel ano={2026} osId={1392} enabled />);
    fireEvent.click(screen.getByRole("button", { name: /Ver tudo/i }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/os/$ano/$id/fluxo-producao",
      params: { ano: "2026", id: "1392" },
    });
  });
});

describe("ProducaoGanttFullPage", () => {
  it("renderiza colunas alinhadas e header de horas", () => {
    wrap(<ProducaoGanttFullPage ano={2026} osId={1392} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Fluxo de produção" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Etapa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Início").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Status").length).toBeGreaterThan(0);
    expect(screen.getByTitle("15/06 08:00")).toBeInTheDocument();
    expect(screen.getAllByText(/08:00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pré-impressão/)).toBeInTheDocument();
  });
});
