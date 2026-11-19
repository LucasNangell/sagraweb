import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaCorelDadosModal } from "./PapelariaCorelDadosModal";

describe("PapelariaCorelDadosModal", () => {
  it("mostra original × formulário e devolve a escolha", () => {
    const manter = vi.fn();
    const usar = vi.fn();
    render(
      <PapelariaCorelDadosModal
        estado={{
          fase: "diferente",
          arquivo: "06592-CtVisita_Base.cdr",
          diferencas: [
            {
              campo: "NomeDep",
              rotulo: "Nome do deputado/deputada",
              original: ["Sargento Gonçalves", "Everton Rocha\nChefe de Gabinete"],
              novo: ["Sargento Gonçalves"],
            },
          ],
        }}
        onManterOriginais={manter}
        onUsarFormulario={usar}
        onCancelar={() => undefined}
      />,
    );
    const lista = screen.getByTestId("papelaria-corel-dados-diferencas");
    expect(lista).toHaveTextContent("Nome do deputado/deputada");
    expect(lista).toHaveTextContent("Everton Rocha");
    expect(screen.getByText(/06592-CtVisita_Base\.cdr/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("papelaria-corel-dados-manter"));
    expect(manter).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("papelaria-corel-dados-formulario"));
    expect(usar).toHaveBeenCalledOnce();
  });

  it("enquanto lê só permite cancelar", () => {
    const cancelar = vi.fn();
    render(
      <PapelariaCorelDadosModal
        estado={{ fase: "lendo", arquivo: "a.cdr" }}
        onManterOriginais={() => undefined}
        onUsarFormulario={() => undefined}
        onCancelar={cancelar}
      />,
    );
    expect(screen.queryByTestId("papelaria-corel-dados-manter")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cancelar).toHaveBeenCalledOnce();
  });
});
