import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaCorelDadosModal } from "./PapelariaCorelDadosModal";
import type { PapelariaCorelDiferenca } from "../types";

const DIF: PapelariaCorelDiferenca[] = [
  {
    campo: "NomeDep",
    rotulo: "Nome do deputado/deputada",
    editavel: true,
    original: [],
    novo: [],
    ocorrencias: [
      { face: "Frente", x: 42, y: 28, rotulo: "Frente", original: "Sargento Gonçalves", novo: "Sargento Gonçalves" },
      { face: "Verso", x: 23, y: 25, rotulo: "Verso", original: "Everton Rocha\nChefe de Gabinete", novo: "Sargento Gonçalves" },
    ],
  },
];

function renderModal(handlers: Partial<Record<"onConfirmar" | "onCancelar", ReturnType<typeof vi.fn>>> = {}) {
  return render(
    <PapelariaCorelDadosModal
      estado={{ fase: "diferente", arquivo: "06592-CtVisita_Base.cdr", diferencas: DIF }}
      onConfirmar={handlers.onConfirmar ?? vi.fn()}
      onManterOriginais={vi.fn()}
      onUsarFormulario={vi.fn()}
      onCancelar={handlers.onCancelar ?? vi.fn()}
    />,
  );
}

describe("PapelariaCorelDadosModal", () => {
  it("mostra Corel × formulário por ocorrência com texto editável (começa no Corel)", () => {
    renderModal();
    const lista = screen.getByTestId("papelaria-corel-dados-diferencas");
    expect(lista).toHaveTextContent("Nome do deputado/deputada");
    expect(lista).toHaveTextContent("Verso");
    expect(screen.getByText(/igual ao formulário/)).toBeInTheDocument();
    const verso = screen.getByTestId("papelaria-corel-dados-valor-NomeDep-1") as HTMLTextAreaElement;
    expect(verso.value).toBe("Everton Rocha\nChefe de Gabinete");
  });

  it("edição e atalhos chegam no confirmar", () => {
    const confirmar = vi.fn();
    renderModal({ onConfirmar: confirmar });
    fireEvent.change(screen.getByTestId("papelaria-corel-dados-valor-NomeDep-1"), {
      target: { value: "Fulano\nAssessor" },
    });
    fireEvent.click(screen.getByTestId("papelaria-corel-dados-confirmar"));
    expect(confirmar).toHaveBeenLastCalledWith({
      "NomeDep#0": "Sargento Gonçalves",
      "NomeDep#1": "Fulano\nAssessor",
    });

    fireEvent.click(screen.getByTestId("papelaria-corel-dados-tudo-formulario"));
    fireEvent.click(screen.getByTestId("papelaria-corel-dados-confirmar"));
    expect(confirmar).toHaveBeenLastCalledWith({
      "NomeDep#0": "Sargento Gonçalves",
      "NomeDep#1": "Sargento Gonçalves",
    });
  });

  it("falha na leitura oferece manter ou usar o formulário", () => {
    const manter = vi.fn();
    render(
      <PapelariaCorelDadosModal
        estado={{ fase: "falhou", arquivo: "a.cdr", erro: "Corel ocupado." }}
        onConfirmar={vi.fn()}
        onManterOriginais={manter}
        onUsarFormulario={vi.fn()}
        onCancelar={vi.fn()}
      />,
    );
    expect(screen.getByText(/Corel ocupado/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("papelaria-corel-dados-manter"));
    expect(manter).toHaveBeenCalledOnce();
  });

  it("enquanto lê só permite cancelar", () => {
    const cancelar = vi.fn();
    render(
      <PapelariaCorelDadosModal
        estado={{ fase: "lendo", arquivo: "a.cdr" }}
        onConfirmar={vi.fn()}
        onManterOriginais={vi.fn()}
        onUsarFormulario={vi.fn()}
        onCancelar={cancelar}
      />,
    );
    expect(screen.queryByTestId("papelaria-corel-dados-confirmar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cancelar).toHaveBeenCalledOnce();
  });
});
