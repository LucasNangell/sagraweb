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

describe("Repetição frente e verso nas listas", () => {
  const faces = {
    disponivel: true,
    frente: [{ modelo_id: 15, pagina: 1, rotulo: "Ct Visita F", tem_pdf: true }],
    verso: [{ modelo_id: 28, pagina: 1, rotulo: "Verso assessor", tem_pdf: true }],
    padrao: { frente: null, verso: null },
  } as never;

  it("Repetição — Frente e Repetição — Verso; escolher manda a face da repetição (modelo 0)", () => {
    const onSelectFrente = vi.fn();
    const onSelectVerso = vi.fn();
    render(
      <PapelariaModelosLista
        modelos={[]}
        selectedModelId={15}
        onSelectModel={vi.fn()}
        faces={faces}
        composicao={{ frente: { modelo_id: 0, pagina: 1 }, verso: { modelo_id: 28, pagina: 1 } }}
        onSelectFrente={onSelectFrente}
        onSelectVerso={onSelectVerso}
        repeticao={{ rotulo: "6254/26", ativo: false, onSelect: vi.fn(), faces: ["frente", "verso"] }}
      />,
    );
    expect(screen.getByTestId("papelaria-frente-repeticao")).toHaveTextContent("Repetição da SP 6254/26 — Frente");
    expect(screen.getByTestId("papelaria-frente-repeticao")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("papelaria-frente-15")).toHaveAttribute("aria-pressed", "false");
    // Verso do modelo escolhido junto com a frente da repetição.
    expect(screen.getByTestId("papelaria-verso-28")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("papelaria-verso-repeticao"));
    expect(onSelectVerso).toHaveBeenCalledWith(expect.objectContaining({ modelo_id: 0, pagina: 2 }));
    fireEvent.click(screen.getByTestId("papelaria-frente-repeticao"));
    expect(onSelectFrente).toHaveBeenCalledWith(expect.objectContaining({ modelo_id: 0, pagina: 1 }));
  });

  it("OS repetida só frente: não oferece Repetição — Verso", () => {
    render(
      <PapelariaModelosLista
        modelos={[]}
        selectedModelId={15}
        onSelectModel={vi.fn()}
        faces={faces}
        composicao={{ frente: { modelo_id: 0, pagina: 1 }, verso: { modelo_id: 28, pagina: 1 } }}
        repeticao={{ rotulo: "6254/26", ativo: false, onSelect: vi.fn(), faces: ["frente"] }}
      />,
    );
    expect(screen.getByTestId("papelaria-frente-repeticao")).toBeInTheDocument();
    expect(screen.queryByTestId("papelaria-verso-repeticao")).not.toBeInTheDocument();
  });

  it("a composição mantém as faces da repetição quando a lista recarrega", async () => {
    const { composicaoMantendoVerso } = await import("./PapelariaFrenteVersoPicker");
    const r = composicaoMantendoVerso(faces, 15, "auto", {
      frente: { modelo_id: 0, pagina: 1 },
      verso: { modelo_id: 0, pagina: 2 },
    });
    expect(r).toEqual({ frente: { modelo_id: 0, pagina: 1 }, verso: { modelo_id: 0, pagina: 2 } });
  });
});

describe("Prova anterior no padrão antigo (alteração)", () => {
  it("sem base: mostra o arquivo e o «Montar prévia da prova anterior»", () => {
    const onReplicar = vi.fn();
    render(
      <PapelariaReplicarSp
        repeticao={{
          origem_nro: 6242,
          origem_ano: 2026,
          rotulo: "6242/26",
          base: null,
          propria: true,
          prova_antiga: "06242-Fulano-Prova1_SEFOC.pdf",
        }}
        pending={false}
        onReplicar={onReplicar}
      />,
    );
    expect(screen.queryByTestId("papelaria-replicar-sp")).toBeNull();
    expect(screen.getByTestId("papelaria-prova-antiga")).toHaveTextContent("06242-Fulano-Prova1_SEFOC.pdf");
    const botao = screen.getByTestId("papelaria-prova-antiga-montar");
    expect(botao).toHaveTextContent("Montar prévia da prova anterior");
    fireEvent.click(botao);
    expect(onReplicar).toHaveBeenCalledWith(null);
  });

  it("com base: «Remontar da prova anterior» e card «Prova anterior» na lista", () => {
    render(
      <>
        <PapelariaReplicarSp
          repeticao={{
            origem_nro: 6242,
            origem_ano: 2026,
            rotulo: "6242/26",
            base: { arquivo_origem: "06242-Prova1.pdf", propria: true, faces: [] },
            propria: true,
          }}
          pending={false}
          onReplicar={vi.fn()}
        />
        <PapelariaModelosLista
          modelos={[]}
          selectedModelId={null}
          onSelectModel={vi.fn()}
          repeticao={{ rotulo: "6242/26", nome: "Prova anterior", ativo: true, onSelect: vi.fn() }}
        />
      </>,
    );
    expect(screen.getByTestId("papelaria-prova-antiga-montar")).toHaveTextContent("Remontar da prova anterior");
    expect(screen.getByTestId("papelaria-modelo-repeticao")).toHaveTextContent("Prova anterior");
    expect(screen.getByTestId("papelaria-modelo-repeticao")).not.toHaveTextContent("Repetição");
  });
});
