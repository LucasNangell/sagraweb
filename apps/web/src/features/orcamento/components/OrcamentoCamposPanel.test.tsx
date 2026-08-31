import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrcamentoCamposPanel } from "./OrcamentoCamposPanel";
import { stubOrcamentoResponse } from "@/features/orcamento/orcamentoTestFixtures";

describe("OrcamentoCamposPanel compact", () => {
  it("mostra comparativo Digital × Offset e não mostra a prévia do ofício", () => {
    const data = stubOrcamentoResponse();
    render(
      <OrcamentoCamposPanel
        variant="compact"
        entrada={data.entrada}
        computed={data}
        onEntradaChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Comparativo Digital × Offset")).toBeInTheDocument();
    expect(screen.getByText("Dados do serviço")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Digital/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Offset/ })).toBeInTheDocument();
    expect(screen.queryByText(/CÂMARA DOS DEPUTADOS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(prévia\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("ORÇAMENTO")).not.toBeInTheDocument();
  });

  it("mostra Material com insumos detalhados, não Papel como linha-pai", () => {
    const data = stubOrcamentoResponse();
    render(
      <OrcamentoCamposPanel
        variant="compact"
        entrada={data.entrada}
        computed={data}
        onEntradaChange={vi.fn()}
      />,
    );

    const detalhe = screen.getByText(/Detalhamento/).closest("div");
    expect(detalhe).toBeTruthy();
    expect(within(detalhe as HTMLElement).getByText("Material")).toBeInTheDocument();
    expect(within(detalhe as HTMLElement).getByText("Papel — Couche fosco 300g")).toBeInTheDocument();
    expect(within(detalhe as HTMLElement).queryByText("Papel")).not.toBeInTheDocument();
    expect(within(detalhe as HTMLElement).queryByText("Cliques (Digital)")).not.toBeInTheDocument();
  });
});
