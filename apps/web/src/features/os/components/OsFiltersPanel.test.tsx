import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultOsFilters, useOsFiltersStore } from "../osFiltersStore";
import { OsFiltersPanel } from "./OsFiltersPanel";

vi.mock("@/api/hooks/useOsFilterOptions", () => ({
  useOsFilterYears: () => ({ data: { data: [2026] }, isLoading: false }),
  useOsFilterProducts: () => ({ data: { data: [] }, isFetching: false }),
  useOsFilterRequesters: () => ({ data: { data: [] }, isFetching: false }),
  useOsFilterFormatos: () => ({
    data: { data: [{ value: "A4", label: "A4" }] },
    isFetching: false,
  }),
}));

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useCategoriasLookup: () => ({ data: [], isLoading: false }),
  useMaquinasLookup: () => ({ data: [], isLoading: false }),
  useSetoresLookup: () => ({ data: [], isLoading: false }),
  useSituacoesLookup: () => ({ data: [], isLoading: false }),
}));

function renderPanel(
  onPatchFilters = vi.fn(),
  onResetFilters = vi.fn(),
  extra: Partial<Parameters<typeof OsFiltersPanel>[0]> = {},
) {
  return render(
    <OsFiltersPanel
      onRefresh={vi.fn()}
      savedFilters={[]}
      savedFilterId=""
      onSavedFilterChange={vi.fn()}
      titleStatus="Filtros de Pesquisa"
      onPatchFilters={onPatchFilters}
      onResetFilters={onResetFilters}
      {...extra}
    />,
  );
}

describe("OsFiltersPanel advanced filters", () => {
  beforeEach(() => {
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("abre e fecha a faixa com aria-expanded", () => {
    renderPanel();
    const toggle = screen.getByTestId("os-filters-advanced-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("os-filters-papel")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("os-filters-papel")).toBeInTheDocument();
    expect(screen.getByTestId("os-filters-formato")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("os-filters-papel")).not.toBeInTheDocument();
  });

  it("abre automaticamente quando já há filtro avançado", () => {
    useOsFiltersStore.setState({
      filters: { ...defaultOsFilters(), papel: "couché" },
    });
    renderPanel();
    expect(screen.getByTestId("os-filters-advanced-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("os-filters-papel")).toHaveValue("couché");
  });

  it("não dispara patch da busca ao digitar no dropdown de formato", () => {
    const onPatchFilters = vi.fn();
    renderPanel(onPatchFilters);
    fireEvent.click(screen.getByTestId("os-filters-advanced-toggle"));
    fireEvent.click(screen.getByTestId("os-filters-formato"));
    const search = screen.getByPlaceholderText("Digite para filtrar...");
    fireEvent.change(search, { target: { value: "A5" } });
    expect(onPatchFilters).not.toHaveBeenCalled();
  });
});

describe("OsFiltersPanel save current filters", () => {
  beforeEach(() => {
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("não mostra o botão de salvar sem callback", () => {
    renderPanel();
    expect(screen.queryByTestId("os-filters-save")).not.toBeInTheDocument();
  });

  it("mostra o botão e dispara o callback", () => {
    const onSaveCurrentFilters = vi.fn();
    renderPanel(vi.fn(), vi.fn(), { onSaveCurrentFilters });
    fireEvent.click(screen.getByTestId("os-filters-save"));
    expect(onSaveCurrentFilters).toHaveBeenCalledTimes(1);
  });
});
