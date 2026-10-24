import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG } from "../constants";
import { DashboardSetorSettingsModal } from "./DashboardSetorSettingsModal";

afterEach(cleanup);

const props = {
  open: true,
  config: DEFAULT_DASHBOARD_CONFIG,
  setoresList: ["SEFOC"],
  andamentosList: ["Recebido"],
  onClose: vi.fn(),
  onSave: vi.fn(),
  onClearCache: vi.fn(),
};

describe("opção de tempo da OS", () => {
  it("fica de fora dos painéis que não têm o relógio", () => {
    render(<DashboardSetorSettingsModal {...props} />);
    expect(
      screen.queryByRole("checkbox", { name: "Exibir o tempo da OS nos cards" }),
    ).not.toBeInTheDocument();
  });

  it("salva a preferência desmarcada e volta a exibir quando marcada", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <DashboardSetorSettingsModal {...props} onSave={onSave} showTimeOption />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: "Exibir o tempo da OS nos cards",
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Salvar e Recarregar" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ showAndamentoTime: false }),
    );

    rerender(
      <DashboardSetorSettingsModal
        {...props}
        onSave={onSave}
        showTimeOption
        config={{ ...DEFAULT_DASHBOARD_CONFIG, showAndamentoTime: false }}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Exibir o tempo da OS nos cards" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Exibir o tempo da OS nos cards" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar e Recarregar" }));
    expect(onSave.mock.calls[1]?.[0].showAndamentoTime).toBeUndefined();
  });
});
