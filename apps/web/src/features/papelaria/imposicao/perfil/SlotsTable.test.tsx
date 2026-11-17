import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { perfilVazio } from "./perfilUtils";
import { SlotsTable } from "./SlotsTable";

function perfilManual() {
  const p = perfilVazio();
  p.folha = { largura_mm: 745, altura_mm: 605 };
  p.pagina = { fonte: "fixa", largura_mm: 220, altura_mm: 320 };
  p.posicionamento = "manual";
  // Gravado com origem no topo: centro a 210 mm do topo.
  p.slots.frente = [{ id: 1, x_mm: 532.46, y_mm: 210, rotacao: 90, pagina: 1 }];
  return p;
}

describe("SlotsTable — Y a partir do canto inferior esquerdo", () => {
  it("mostra Y de baixo para cima e grava no sistema do topo", () => {
    const onChange = vi.fn();
    render(
      <SlotsTable perfil={perfilManual()} face="frente" selectedId={null} onSelect={() => {}} onChange={onChange} />,
    );
    const y = screen.getByLabelText("Y do centro do slot 1") as HTMLInputElement;
    expect(y.value).toBe("395");
    fireEvent.change(y, { target: { value: "400" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, x_mm: 532.46, y_mm: 205 }),
    ]);
  });
});
