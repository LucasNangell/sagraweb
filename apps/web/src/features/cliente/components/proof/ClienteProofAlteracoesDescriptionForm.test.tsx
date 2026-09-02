import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClienteProofAlteracoesDescriptionForm } from "./ClienteProofPortalExtras";

describe("ClienteProofAlteracoesDescriptionForm", () => {
  it("mostra o título do campo de descrição", () => {
    render(
      <ClienteProofAlteracoesDescriptionForm
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Descreva as alterações desejadas")).toBeInTheDocument();
  });

  it("chama onCancel ao clicar em Cancelar", () => {
    const onCancel = vi.fn();
    render(
      <ClienteProofAlteracoesDescriptionForm
        value="trocar a cor"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("chama onSubmit ao clicar em Solicitar alterações", () => {
    const onSubmit = vi.fn();
    render(
      <ClienteProofAlteracoesDescriptionForm
        value="trocar a cor"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /solicitar alterações/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
