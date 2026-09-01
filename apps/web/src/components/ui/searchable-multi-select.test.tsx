import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchableMultiSelect } from "./searchable-multi-select";

const OPTIONS = [
  { value: "Ana Silva", label: "Ana Silva" },
  { value: "João da Silva", label: "João da Silva" },
  { value: "Maria", label: "Maria" },
];

function openSelect(onChange = vi.fn(), value: string[] = []) {
  render(
    <SearchableMultiSelect
      label="Nome"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      searchQuery=""
      onSearchChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Nome" }));
  return screen.getByPlaceholderText("Digite para filtrar...");
}

describe("SearchableMultiSelect keyboard", () => {
  it("seta para baixo destaca o segundo item e Tab inclui esse valor", () => {
    const onChange = vi.fn();
    const input = openSelect(onChange);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getByRole("option", { name: "João da Silva" })).toHaveClass(
      "bg-slate-100",
    );
    expect(screen.getByRole("option", { name: "Ana Silva" })).not.toHaveClass(
      "bg-slate-100",
    );

    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).toHaveBeenCalledWith(["João da Silva"]);
  });

  it("seta para a direita seleciona o item destacado como o Tab", () => {
    const onChange = vi.fn();
    const input = openSelect(onChange);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith(["João da Silva"]);
  });

  it("Tab não desmarca o item já selecionado", () => {
    const onChange = vi.fn();
    const input = openSelect(onChange, ["João da Silva"]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
