import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MultiSelect } from "./multi-select";

describe("MultiSelect labelSide left", () => {
  it("usa layout empilhável sensível ao container os-filters", () => {
    const { container } = render(
      <div className="@container/os-filters">
        <MultiSelect
          label="Categoria"
          labelSide="left"
          options={["A"]}
          value={[]}
          onChange={vi.fn()}
        />
      </div>,
    );
    const root = container.firstElementChild?.firstElementChild;
    expect(root?.className).toContain("@min-[56rem]/os-filters:flex-row");
    expect(screen.getByText("Categoria:")).toBeInTheDocument();
  });
});

describe("MultiSelect empty list", () => {
  it("mostra Nenhuma opção quando a lista está vazia e não está carregando", () => {
    render(
      <MultiSelect
        label="Categoria"
        options={[]}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    expect(screen.getByText("Nenhuma opção")).toBeInTheDocument();
  });

  it("mostra Carregando... quando isLoading e a lista está vazia", () => {
    render(
      <MultiSelect
        label="Categoria"
        options={[]}
        value={[]}
        onChange={vi.fn()}
        isLoading
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });
});
