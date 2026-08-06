import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GravacaoPendenteHistoricoCota } from "./GravacaoPendenteHistoricoCota";

vi.mock("./GravacaoPendenteDetalhesModal", () => ({
  GravacaoPendenteDetalhesModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="detalhes-modal">Detalhes modal</div> : null,
}));

describe("GravacaoPendenteHistoricoCota", () => {
  it("agrupa Komori e SM74 no mesmo KPI de restantes", () => {
    render(
      <GravacaoPendenteHistoricoCota
        maquinas={[
          { maquina: "Komori", cota_chapas: 30, chapas_restantes: 18 },
          { maquina: "SM74", cota_chapas: 20, chapas_restantes: 12 },
          { maquina: "PM52", cota_chapas: 5, chapas_restantes: 5 },
        ]}
        totalGravadas={20}
        restantes={35}
      />,
    );

    expect(screen.getByText(/Restantes por máquina/i)).toBeTruthy();
    expect(screen.queryByLabelText("Cota inicial de chapas")).toBeNull();
    // 18 + 12 = pool compartilhado Komori/SM74
    expect(screen.getByLabelText("Restantes Komori / SM74").textContent).toBe("30");
    expect(screen.getByLabelText("Restantes PM52").textContent).toBe("5");
    expect(screen.queryByLabelText("Restantes Komori")).toBeNull();
    expect(screen.queryByLabelText("Restantes SM74")).toBeNull();
    expect(screen.getByLabelText("Total gravadas").textContent).toBe("20");
    expect(screen.getByLabelText("Chapas restantes").textContent).toBe("35");
    expect(screen.getByRole("button", { name: /detalhes/i })).toBeTruthy();
  });

  it("destaca restantes negativos do pool Komori/SM74", () => {
    render(
      <GravacaoPendenteHistoricoCota
        maquinas={[
          { maquina: "Komori", cota_chapas: 10, chapas_restantes: -1 },
          { maquina: "SM74", cota_chapas: 5, chapas_restantes: -1 },
        ]}
        totalGravadas={17}
        restantes={-2}
      />,
    );

    expect(screen.getByLabelText("Restantes Komori / SM74").className).toMatch(
      /text-red-600/,
    );
  });

  it("abre modal Detalhes ao clicar no botão", () => {
    render(
      <GravacaoPendenteHistoricoCota
        maquinas={[]}
        totalGravadas={3}
        restantes={7}
      />,
    );

    expect(screen.queryByTestId("detalhes-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /detalhes/i }));
    expect(screen.getByTestId("detalhes-modal")).toBeTruthy();
  });
});
