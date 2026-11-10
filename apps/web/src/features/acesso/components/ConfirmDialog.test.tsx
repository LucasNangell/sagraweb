import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>("—");
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({ title: "Excluir?", confirmLabel: "Sim, excluir", danger: true }).then((ok) =>
            setResult(String(ok)),
          )
        }
      >
        abrir
      </button>
      <span data-testid="result">{result}</span>
    </>
  );
}

describe("ConfirmDialog", () => {
  it("resolve true ao confirmar e false ao cancelar/Esc", async () => {
    render(
      <ConfirmProvider>
        <Harness />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByText("abrir"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Foco inicial no Cancelar (Enter acidental não confirma).
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("abrir"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("false"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("sem provider cai no window.confirm nativo", async () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness />);
    fireEvent.click(screen.getByText("abrir"));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("true"));
    expect(spy).toHaveBeenCalledWith("Excluir?");
    spy.mockRestore();
  });
});
