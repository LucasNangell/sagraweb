import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyGerenciaForm } from "../defaults";
import { createEmptyTechSpec } from "../techSpec";
import { CalculosCustosPanel } from "./CalculosCustosPanel";

function documentOrder(earlier: HTMLElement, later: HTMLElement) {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("CalculosCustosPanel", () => {
  it("coloca páginas por componente acima de tiragem e cota", () => {
    render(
      <CalculosCustosPanel
        form={createEmptyGerenciaForm()}
        update={vi.fn()}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );

    const pagesHeading = screen.getByText("Páginas por componente");
    const cotaAtual = screen.getByLabelText("Cota atual");
    const tiragemMax = screen.getByLabelText("Tiragem máxima");
    const tiragemFinal = screen.getByLabelText("Tiragem final");
    const coeficiente = screen.getByLabelText("Coeficiente A4");
    const cotaEstimada = screen.getByLabelText("Cota estimada");

    expect(documentOrder(pagesHeading, cotaAtual)).toBe(true);
    expect(documentOrder(cotaAtual, tiragemMax)).toBe(true);
    expect(documentOrder(tiragemMax, tiragemFinal)).toBe(true);
    expect(documentOrder(tiragemFinal, coeficiente)).toBe(true);
    expect(documentOrder(coeficiente, cotaEstimada)).toBe(true);
    expect(screen.queryByLabelText("Total Páginas")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Altura (mm)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Largura (mm)")).not.toBeInTheDocument();
    expect(screen.queryByText("Tiragem")).not.toBeInTheDocument();
  });
});
