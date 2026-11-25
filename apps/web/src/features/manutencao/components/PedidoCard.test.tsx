import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ManutencaoPedido } from "@/api/manutencao";

import { PedidoCard } from "./PedidoCard";

const BASE: ManutencaoPedido = {
  id: 9,
  maquina_id: 1,
  maquina_nome: "Guilhotina A",
  titulo: "Trocar lâmina",
  prioridade: "normal",
  status: "pausado",
  maquina_parada: false,
  iniciado_por: "100",
  iniciado_por_nome: "Iniciou",
  pausado_por: "200",
  pausado_por_nome: "Operador Fulano",
  pausado_em: new Date(Date.now() - 20 * 60_000).toISOString(),
  pausa_motivo: "Aguardando peça",
  diagnostico: "Lâmina com dente quebrado",
  solucao_passos: ["Desligar a máquina", "Retirar a lâmina"],
};

describe("PedidoCard — pausado", () => {
  it("mostra quem pausou, motivo, diagnóstico e passos feitos", () => {
    render(<PedidoCard pedido={BASE} onAbrir={vi.fn()} />);
    expect(screen.getByText(/Pausado por Operador Fulano/)).toBeInTheDocument();
    expect(screen.getByText("Aguardando peça")).toBeInTheDocument();
    expect(screen.getByText("Lâmina com dente quebrado")).toBeInTheDocument();
    expect(screen.getByText("2 passos feitos")).toBeInTheDocument();
    expect(screen.getByText(/último: Retirar a lâmina/)).toBeInTheDocument();
  });

  it("sem o evento de pausa, atribui a quem iniciou", () => {
    render(
      <PedidoCard
        pedido={{ ...BASE, pausado_por: null, pausado_em: null, solucao_passos: [] }}
        onAbrir={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pausado por Iniciou/)).toBeInTheDocument();
    expect(screen.getByText("Nenhum passo registrado")).toBeInTheDocument();
  });

  it("em execução não mostra o bloco de pausa", () => {
    render(<PedidoCard pedido={{ ...BASE, status: "em_execucao" }} onAbrir={vi.fn()} />);
    expect(screen.queryByText(/Pausado por/)).toBeNull();
  });
});
