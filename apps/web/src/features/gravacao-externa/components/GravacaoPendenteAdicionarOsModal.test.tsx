import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteAdicionarOsModal } from "./GravacaoPendenteAdicionarOsModal";

const fetchOsDetails = vi.hoisted(() => vi.fn());

vi.mock("@/api/os", () => ({ fetchOsDetails }));
vi.mock("./GravacaoPendenteLaunchModal", () => ({
  GravacaoPendenteLaunchModal: ({
    row,
    workflow,
    onConfirm,
  }: {
    row: { nr_os: number; ano: number };
    workflow: string;
    onConfirm: (result: {
      arquivos: never[];
      chapas: never[];
      obs: string;
      juntadas: never[];
    }) => void;
  }) => (
    <div role="dialog" aria-label="Selecionar arquivos">
      <span>{`${row.nr_os}/${row.ano}/${workflow}`}</span>
      <button
        type="button"
        onClick={() =>
          onConfirm({ arquivos: [], chapas: [], obs: "", juntadas: [] })
        }
      >
        Confirmar arquivos
      </button>
    </div>
  ),
}));

describe("GravacaoPendenteAdicionarOsModal", () => {
  beforeEach(() => {
    fetchOsDetails.mockReset();
    fetchOsDetails.mockResolvedValue({});
  });

  it("valida a OS e abre o seletor de arquivos no fluxo sem andamento", async () => {
    const onConfirm = vi.fn();
    render(
      <GravacaoPendenteAdicionarOsModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText("Número da OS"), {
      target: { value: "101" },
    });
    fireEvent.change(screen.getByLabelText("Ano"), {
      target: { value: "26" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(fetchOsDetails).toHaveBeenCalledWith(2026, 101));
    expect(screen.getByText("101/2026/fila")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar arquivos" }));
    expect(onConfirm).toHaveBeenCalledWith(
      { nr_os: 101, ano: 2026 },
      { arquivos: [], chapas: [], obs: "", juntadas: [] },
    );
  });
});
