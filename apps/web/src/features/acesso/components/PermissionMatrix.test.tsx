import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PermissionKey } from "@/features/auth/types";

import { PermissionMatrix } from "./PermissionMatrix";

describe("PermissionMatrix", () => {
  it("marca a categoria inteira só com as chaves editáveis do alvo", () => {
    const onChange = vi.fn();
    render(<PermissionMatrix target="ip" values={{}} onChange={onChange} />);

    const group = screen.getByRole("group", { name: "Menu de contexto da OS" });
    fireEvent.click(within(group).getByRole("button", { name: "Marcar categoria" }));

    const next = onChange.mock.calls[0]![0] as Partial<Record<PermissionKey, boolean>>;
    expect(next.ctx_nova_os).toBe(true);
    expect(next.ctx_orcamento).toBe(true);
    // Prova WEB é só de usuário: não pode ser marcada no terminal.
    expect(next.ctx_prova_web).toBeUndefined();
  });

  it("chave fora de escopo aparece desabilitada com explicação", () => {
    render(<PermissionMatrix target="ip" values={{}} onChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /Prova WEB/ });
    expect(checkbox).toBeDisabled();
    expect(screen.getAllByText("Concedida apenas por usuário.").length).toBeGreaterThan(0);
  });

  it("chaves geridas externamente ficam desabilitadas no usuário", () => {
    render(
      <PermissionMatrix
        target="user"
        values={{}}
        onChange={vi.fn()}
        externallyManaged={["sb_dashboard_global"]}
        externallyManagedHint="Definido na seção Painéis abaixo."
      />,
    );
    expect(screen.getByRole("checkbox", { name: /Painel global/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Prova WEB/ })).toBeEnabled();
  });

  it("busca filtra por rótulo sem acento e contador reflete as ativas", () => {
    render(
      <PermissionMatrix target="ip" values={{ sb_inicio: true, sb_pcp: true }} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("permission-matrix-count")).toHaveTextContent("2 de 36 ativas");
    fireEvent.change(screen.getByPlaceholderText("Buscar permissão…"), {
      target: { value: "orcamento" },
    });
    expect(screen.getByRole("checkbox", { name: /Orçamento/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Início/ })).not.toBeInTheDocument();
  });

  it("mostra valores de referência ao lado", () => {
    render(
      <PermissionMatrix
        target="user"
        values={{}}
        onChange={vi.fn()}
        referenceValues={{ sb_inicio: true, sb_gerencia: false }}
        referenceLabel="Terminal 10.0.0.1"
      />,
    );
    expect(screen.getByTitle("Terminal 10.0.0.1: sim")).toBeInTheDocument();
    expect(screen.getAllByTitle("Terminal 10.0.0.1: não").length).toBeGreaterThan(0);
  });
});
