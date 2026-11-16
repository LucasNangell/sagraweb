import { fireEvent, render, screen } from "@testing-library/react";
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
    const modelos = screen.getByLabelText("Qt. Modelos");
    const coeficiente = screen.getByLabelText("Coeficiente A4");
    const cotaEstimada = screen.getByLabelText("Cota estimada");

    expect(documentOrder(pagesHeading, cotaAtual)).toBe(true);
    expect(documentOrder(cotaAtual, tiragemMax)).toBe(true);
    expect(documentOrder(tiragemMax, tiragemFinal)).toBe(true);
    expect(documentOrder(tiragemFinal, modelos)).toBe(true);
    expect(documentOrder(modelos, coeficiente)).toBe(true);
    expect(documentOrder(coeficiente, cotaEstimada)).toBe(true);
    expect(screen.queryByLabelText("Total Páginas")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Altura (mm)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Largura (mm)")).not.toBeInTheDocument();
    expect(screen.queryByText("Tiragem")).not.toBeInTheDocument();
  });

  it("permite editar o coeficiente A4 quando a OS não está só leitura", () => {
    render(
      <CalculosCustosPanel
        form={createEmptyGerenciaForm()}
        update={vi.fn()}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );
    expect(screen.getByLabelText("Coeficiente A4")).not.toHaveAttribute(
      "readonly",
    );
  });

  it("ao editar o coeficiente A4 dispara update com o novo valor", () => {
    const update = vi.fn();
    render(
      <CalculosCustosPanel
        form={{
          ...createEmptyGerenciaForm(),
          calc_coef_a4: "6,1",
          calc_cota_total: "4",
        }}
        update={update}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Coeficiente A4"), {
      target: { value: "7,0" },
    });
    expect(update).toHaveBeenCalledWith({ calc_coef_a4: "7,0" });
  });

  it("permite editar a cota estimada quando a OS não está só leitura", () => {
    render(
      <CalculosCustosPanel
        form={{
          ...createEmptyGerenciaForm(),
          calc_cota_total: "1.189",
        }}
        update={vi.fn()}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );
    expect(screen.getByLabelText("Cota estimada")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByRole("button", { name: "Calcular" })).toBeEnabled();
  });

  it("ao editar a cota estimada dispara update com o novo valor", () => {
    const update = vi.fn();
    render(
      <CalculosCustosPanel
        form={{
          ...createEmptyGerenciaForm(),
          calc_cota_total: "4",
        }}
        update={update}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Cota estimada"), {
      target: { value: "500" },
    });
    expect(update).toHaveBeenCalledWith({ calc_cota_total: "500" });
  });

  it("botão Calcular dispara update com função que recalcula a cota", () => {
    const update = vi.fn();
    const form = {
      ...createEmptyGerenciaForm(),
      calc_miolo_pb: "1",
      val_pgs: "1",
      calc_tiragem: "400",
      calc_altura: "210",
      calc_largura: "297",
      calc_coef_a4: "0,9",
      calc_cota_total: "999",
    };
    render(
      <CalculosCustosPanel
        form={form}
        update={update}
        techSpec={createEmptyTechSpec()}
        readOnly={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(update).toHaveBeenCalledTimes(1);
    const updater = update.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    const next = updater(form);
    expect(next.calc_cota_total).not.toBe("999");
    expect(next.calc_cota_total).toBeTruthy();
  });
});
