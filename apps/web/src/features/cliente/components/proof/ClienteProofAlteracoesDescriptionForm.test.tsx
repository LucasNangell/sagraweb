import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClienteProofAlteracoesDescriptionForm } from "./ClienteProofPortalExtras";

const defaultProps = {
  value: "",
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  onExampleFile: vi.fn(),
};

describe("ClienteProofAlteracoesDescriptionForm", () => {
  it("mostra o título do campo de descrição", () => {
    render(<ClienteProofAlteracoesDescriptionForm {...defaultProps} />);

    expect(screen.getByText("Descreva as alterações desejadas")).toBeInTheDocument();
  });

  it("chama onCancel ao clicar em Cancelar", () => {
    const onCancel = vi.fn();
    render(
      <ClienteProofAlteracoesDescriptionForm
        {...defaultProps}
        value="trocar a cor"
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
        {...defaultProps}
        value="trocar a cor"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /solicitar alterações/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("chama onExampleFile ao clicar em Arquivo de exemplo", () => {
    const onExampleFile = vi.fn();
    render(
      <ClienteProofAlteracoesDescriptionForm
        {...defaultProps}
        onExampleFile={onExampleFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /arquivo de exemplo/i }));
    expect(onExampleFile).toHaveBeenCalledTimes(1);
  });
});
