import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GravacaoObservacaoBox } from "./GravacaoObservacaoBox";

describe("GravacaoObservacaoBox", () => {
  it("não renderiza no modo leitura sem texto", () => {
    const { container } = render(<GravacaoObservacaoBox observacao="  " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra o texto no modo leitura", () => {
    render(<GravacaoObservacaoBox observacao={"Urgente\nfrente e verso"} />);
    expect(screen.getByRole("note")).toHaveTextContent("Urgente");
    expect(screen.getByRole("note")).toHaveTextContent("frente e verso");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("permite incluir observação quando editável e vazia", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GravacaoObservacaoBox editable observacao="" onSave={onSave} />);

    expect(screen.getByText("Nenhuma observação.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.change(screen.getByLabelText("Texto da observação"), {
      target: { value: "Chapa especial" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("Chapa especial");
    });
  });

  it("edita observação existente", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GravacaoObservacaoBox editable observacao="texto atual" onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Texto da observação"), {
      target: { value: "texto novo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("texto novo");
    });
  });
});
