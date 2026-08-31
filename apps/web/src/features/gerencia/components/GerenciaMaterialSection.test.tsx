import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyGerenciaForm } from "../defaults";
import { GerenciaMaterialSection } from "./GerenciaFormSections";

vi.mock("@/features/os/components/OsOriginalFilesPanel", () => ({
  OsOriginalFilesPanel: () => <div>Pastas Original</div>,
}));

describe("GerenciaMaterialSection modal", () => {
  it("une Elementos, Material e Insumos no layout do modal", () => {
    render(
      <GerenciaMaterialSection
        form={{
          ...createEmptyGerenciaForm(),
          op_ano: "2026",
          op_os: "3100",
        }}
        update={vi.fn()}
        readOnly
        layout="modal"
      />,
    );

    expect(screen.getByText("Elementos gráficos")).toBeInTheDocument();
    expect(screen.getByText("Material entregue")).toBeInTheDocument();
    expect(screen.getByLabelText("Insumos Fornecidos")).toBeInTheDocument();
    expect(screen.getByLabelText("Brasão")).toBeInTheDocument();
    expect(screen.getByLabelText("Amostra")).toBeInTheDocument();
    expect(screen.getByLabelText("Fotolito")).toBeInTheDocument();
    expect(screen.getByLabelText("Mod. Dobra")).toBeInTheDocument();
    expect(screen.getByLabelText("Prova Imp.")).toBeInTheDocument();
    expect(
      screen.queryByText("Selecione os elementos institucionais:"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Pastas Original")).toBeInTheDocument();

    const topGrid = screen.getByText("Elementos gráficos").parentElement?.parentElement;
    expect(topGrid?.className).toMatch(/sm:grid-cols-3/);
  });
});
