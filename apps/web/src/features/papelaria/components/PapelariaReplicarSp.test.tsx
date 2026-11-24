import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaModelosLista } from "./PapelariaModelosLista";
import { PapelariaReplicarSp } from "./PapelariaReplicarSp";

describe("PapelariaReplicarSp", () => {
  it("com a OS na observação: botão «Replicar SP 6254/26»", () => {
    const onReplicar = vi.fn();
    render(
      <PapelariaReplicarSp
        repeticao={{ origem_nro: 6254, origem_ano: 2026, rotulo: "6254/26", base: null }}
        pending={false}
        onReplicar={onReplicar}
      />,
    );
    const botao = screen.getByTestId("papelaria-replicar-sp");
    expect(botao).toHaveTextContent("Replicar SP 6254/26");
    fireEvent.click(botao);
    expect(onReplicar).toHaveBeenCalledWith(null);
  });

  it("sem número na observação: o usuário informa a OS", () => {
    const onReplicar = vi.fn();
    render(
      <PapelariaReplicarSp
        repeticao={{ origem_nro: null, origem_ano: null, rotulo: null, base: null }}
        pending={false}
        onReplicar={onReplicar}
      />,
    );
    const botao = screen.getByTestId("papelaria-replicar-sp");
    expect(botao).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número da OS repetida"), { target: { value: "5336" } });
    fireEvent.change(screen.getByLabelText("Ano da OS repetida"), { target: { value: "25" } });
    fireEvent.click(botao);
    expect(onReplicar).toHaveBeenCalledWith({ ano: 2025, nro: 5336 });
  });

  it("base pronta: origem, avisos e «Replicar de novo»", () => {
    render(
      <PapelariaReplicarSp
        repeticao={{
          origem_nro: 6254,
          origem_ano: 2026,
          rotulo: "6254/26",
          base: {
            arquivo_origem: "06254-Ana-Prova2_SEFOC.pdf",
            faces: [
              { face: "frente", metodo: "tamanho do produto", pagina_origem: 1, escala: 1, rotacao: 0 },
              { face: "verso", metodo: "tamanho do produto", pagina_origem: 1, escala: 1, rotacao: 0 },
            ],
            avisos: ["Fonte em subconjunto"],
          },
        }}
        pending={false}
        erro="Falhou"
        onReplicar={vi.fn()}
      />,
    );
    expect(screen.getByTestId("papelaria-replicar-sp")).toHaveTextContent("Replicar de novo");
    expect(screen.getByTestId("papelaria-repeticao-base")).toHaveTextContent("06254-Ana-Prova2_SEFOC.pdf (frente e verso)");
    expect(screen.getByText("Fonte em subconjunto")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });
});

describe("PapelariaModelosLista — repetição", () => {
  const modelos = [{ id: 15, nome_exibicao: "Ct Visita F", arquivo_modelo: "CtVisita.pdf" }] as never;

  it("card da repetição no topo; escolhido, nenhum modelo fica ativo", () => {
    const onSelect = vi.fn();
    render(
      <PapelariaModelosLista
        modelos={modelos}
        selectedModelId={15}
        onSelectModel={vi.fn()}
        repeticao={{ rotulo: "6254/26", ativo: true, onSelect }}
      />,
    );
    const card = screen.getByTestId("papelaria-modelo-repeticao");
    expect(card).toHaveTextContent("Repetição da SP 6254/26");
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("papelaria-modelo-15")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalled();
  });

  it("sem repetição, a lista segue igual", () => {
    render(<PapelariaModelosLista modelos={modelos} selectedModelId={15} onSelectModel={vi.fn()} />);
    expect(screen.queryByTestId("papelaria-modelo-repeticao")).not.toBeInTheDocument();
    expect(screen.getByTestId("papelaria-modelo-15")).toHaveAttribute("aria-pressed", "true");
  });
});
