import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  GravacaoExternaActions,
  GravacaoExternaStatusBadge,
} from "./GravacaoExternaActions";

const baseDetail = {
  id: 1,
  os_ano: 2026,
  os_nro: 100,
  cod_status: "001002026-01",
  lancado_por_ponto: "123",
  status: "pendente",
  arquivos: [],
  mensagens: [],
};

describe("GravacaoExternaActions", () => {
  it("não renderiza botões sem canOperate", () => {
    render(
      <GravacaoExternaActions
        detail={baseDetail}
        canOperate={false}
        onIniciar={vi.fn()}
        onConcluir={vi.fn()}
        iniciando={false}
        concluindo={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /iniciar gravação/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /gravação concluída/i })).toBeNull();
  });

  it("renderiza botões com canOperate", () => {
    render(
      <GravacaoExternaActions
        detail={baseDetail}
        canOperate
        onIniciar={vi.fn()}
        onConcluir={vi.fn()}
        iniciando={false}
        concluindo={false}
      />,
    );

    expect(screen.getByRole("button", { name: /iniciar gravação/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /gravação concluída/i })).toBeTruthy();
  });

  it("badge iniciada inclui engrenagem animada", () => {
    const { container, rerender } = render(
      <GravacaoExternaStatusBadge status="iniciada" />,
    );
    expect(screen.getByText("Iniciada")).toBeTruthy();
    expect(container.querySelector(".gravacao-gear-spin")).toBeTruthy();

    rerender(<GravacaoExternaStatusBadge status="pendente" />);
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(container.querySelector(".gravacao-gear-spin")).toBeNull();
  });

  it("badge pendente e iniciada compartilham a mesma largura mínima", () => {
    const { rerender, container } = render(
      <GravacaoExternaStatusBadge status="iniciada" />,
    );
    const iniciada = container.firstElementChild as HTMLElement;
    expect(iniciada.className).toContain("min-w-[5.75rem]");

    rerender(<GravacaoExternaStatusBadge status="pendente" />);
    const pendente = container.firstElementChild as HTMLElement;
    expect(pendente.className).toContain("min-w-[5.75rem]");
    expect(pendente.className).toContain("justify-center");
  });
});
