import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClienteProofActions } from "./ClienteProofActions";

describe("ClienteProofActions", () => {
  it("exibe ponto acima do nome", () => {
    render(
      <ClienteProofActions
        nomeCliente=""
        ponto=""
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
      />,
    );

    const ponto = screen.getByLabelText(/número de ponto/i);
    const nome = screen.getByLabelText(/^nome/i);
    expect(
      Boolean(ponto.compareDocumentPosition(nome) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("exige nome e ponto para aprovar", () => {
    const onApprove = vi.fn();
    render(
      <ClienteProofActions
        nomeCliente=""
        ponto=""
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={onApprove}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
      />,
    );

    const approveBtn = screen.getByRole("button", { name: /aprovar prova/i });
    expect(approveBtn).toBeDisabled();
  });

  it("exige observações para solicitar alterações", () => {
    const onReject = vi.fn();
    render(
      <ClienteProofActions
        nomeCliente="Maria"
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={onReject}
        isPending={false}
        errorMsg={null}
      />,
    );

    const rejectBtn = screen.getByRole("button", { name: /solicitar alterações/i });
    expect(rejectBtn).toBeDisabled();
  });

  it("permite solicitar alterações sem observação quando requireObsForReject=false", () => {
    const onReject = vi.fn();
    render(
      <ClienteProofActions
        nomeCliente="Maria"
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={onReject}
        isPending={false}
        errorMsg={null}
        requireObsForReject={false}
      />,
    );

    const rejectBtn = screen.getByRole("button", { name: /solicitar alterações/i });
    expect(rejectBtn).not.toBeDisabled();
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("permite solicitar alterações sem observação no portal público", () => {
    const onReject = vi.fn();
    render(
      <ClienteProofActions
        nomeCliente="Maria"
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={onReject}
        isPending={false}
        errorMsg={null}
        publicPortal
      />,
    );

    const rejectBtn = screen.getByRole("button", { name: /solicitar alterações/i });
    expect(rejectBtn).not.toBeDisabled();
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("exibe prefixo P_ no campo ponto do portal público", () => {
    render(
      <ClienteProofActions
        nomeCliente="Maria"
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
        publicPortal
      />,
    );

    expect(screen.getByText("P_")).toBeInTheDocument();
    expect(screen.queryByLabelText(/observações/i)).not.toBeInTheDocument();
  });

  it("habilita aprovação com nome e ponto válidos", () => {
    const onApprove = vi.fn();
    render(
      <ClienteProofActions
        nomeCliente="Maria"
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={onApprove}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /aprovar prova/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("bloqueia o nome enquanto o lookup está em andamento", () => {
    render(
      <ClienteProofActions
        nomeCliente=""
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
        publicPortal
        nomeLookupPending
        nomeLocked
      />,
    );

    expect(screen.getByLabelText(/^nome/i)).toBeDisabled();
    expect(screen.getByText(/buscando/i)).toBeInTheDocument();
  });

  it("libera o nome quando o lookup terminou sem resultado", () => {
    render(
      <ClienteProofActions
        nomeCliente=""
        ponto="918713"
        observacao=""
        onNomeChange={vi.fn()}
        onPontoChange={vi.fn()}
        onObservacaoChange={vi.fn()}
        onApproveClick={vi.fn()}
        onRejectClick={vi.fn()}
        isPending={false}
        errorMsg={null}
        publicPortal
      />,
    );

    expect(screen.getByLabelText(/^nome/i)).not.toBeDisabled();
  });
});
