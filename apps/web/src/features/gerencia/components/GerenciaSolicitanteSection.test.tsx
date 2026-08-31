import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyGerenciaForm } from "../defaults";
import { GerenciaSolicitanteSection } from "./GerenciaFormSections";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("GerenciaSolicitanteSection foto", () => {
  it("mostra o botão Alterar no layout do modal e dispara o callback", () => {
    const onChangePhoto = vi.fn();
    const { container } = render(
      <GerenciaSolicitanteSection
        form={{
          ...createEmptyGerenciaForm(),
          req_solicitante: "Maria Silva",
        }}
        update={vi.fn()}
        readOnly
        layout="modal"
        categorias={["Deputado"]}
        onChangePhoto={onChangePhoto}
      />,
    );

    expect(screen.getByRole("button", { name: "Alterar" })).toBeInTheDocument();

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(["fake"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onChangePhoto).toHaveBeenCalledTimes(1);
    expect(onChangePhoto.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it("não mostra o botão Alterar no layout da página", () => {
    render(
      <GerenciaSolicitanteSection
        form={{
          ...createEmptyGerenciaForm(),
          req_solicitante: "Maria Silva",
        }}
        update={vi.fn()}
        readOnly={false}
        layout="page"
        categorias={["Deputado"]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Alterar" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Foto")).toBeInTheDocument();
  });
});
