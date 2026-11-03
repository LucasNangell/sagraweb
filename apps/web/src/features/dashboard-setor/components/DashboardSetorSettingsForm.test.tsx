import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG } from "../constants";
import { DashboardSetorSettingsForm } from "./DashboardSetorSettingsForm";

afterEach(cleanup);

describe("DashboardSetorSettingsForm admin", () => {
  it("usa dropdown de situações e lista só as selecionadas", () => {
    const onChange = vi.fn();
    render(
      <DashboardSetorSettingsForm
        variant="admin"
        config={{
          ...DEFAULT_DASHBOARD_CONFIG,
          columns: [
            {
              ...DEFAULT_DASHBOARD_CONFIG.columns[0]!,
              statuses: ["Recebido"],
            },
          ],
        }}
        setoresList={["SEFOC"]}
        andamentosList={["Recebido", "Em execução", "Finalizado"]}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Situações desta coluna")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remover Recebido" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Finalizado")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Ocultar quando vazia" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover Recebido" }));
    expect(onChange).toHaveBeenCalled();
  });

  it("permite cor de head diferente em cada coluna", () => {
    const onChange = vi.fn();
    render(
      <DashboardSetorSettingsForm
        variant="admin"
        config={{
          ...DEFAULT_DASHBOARD_CONFIG,
          columns: [
            {
              id: "a",
              title: "Fila",
              statuses: ["Recebido"],
              headerBg: "#112233",
            },
            {
              id: "b",
              title: "Execução",
              statuses: ["Em Execução"],
              headerBg: "#445566",
            },
          ],
        }}
        setoresList={["SEFOC"]}
        andamentosList={["Recebido", "Em Execução"]}
        onChange={onChange}
      />,
    );

    const pickers = screen.getAllByLabelText("Cor do head");
    expect(pickers).toHaveLength(2);
    expect(pickers[0]).toHaveValue("#112233");
    expect(pickers[1]).toHaveValue("#445566");

    fireEvent.change(pickers[1]!, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.columns[0].headerBg).toBe("#112233");
    expect(next.columns[1].headerBg).toBe("#abcdef");
  });
});
