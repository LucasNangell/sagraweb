import { render, screen } from "@testing-library/react";
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
});
