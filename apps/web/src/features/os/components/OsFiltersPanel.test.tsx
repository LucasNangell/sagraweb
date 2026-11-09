import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultOsFilters, useOsFiltersStore } from "../osFiltersStore";
import { OsFiltersPanel } from "./OsFiltersPanel";

const categoriasLookup = vi.hoisted(() => ({
  data: [] as string[],
  isLoading: false,
}));

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
  useCategoriasLookup: () => categoriasLookup,
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

describe("OsFiltersPanel layout responsivo", () => {
  beforeEach(() => {
    categoriasLookup.data = [];
    categoriasLookup.isLoading = false;
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("declara container de filtros e permite wrap dos grupos", () => {
    const { container } = renderPanel();
    const section = container.querySelector("section");
    expect(section?.className).toContain("@container/os-filters");
    expect(section?.className).toContain("z-30");
    expect(section?.className).toContain("overflow-visible");
    const grid = container.querySelector(".os-filter-group-grid");
    expect(grid?.className).toContain("sm:flex-wrap");
    expect(grid?.className).not.toContain("xl:flex-nowrap");
    const group = container.querySelector(".os-filter-group");
    expect(group?.className).toContain("overflow-visible");
    expect(group?.className).not.toContain("overflow-hidden");
    expect(screen.getByTestId("os-filters-nr-os")).toBeInTheDocument();
    expect(screen.getByTestId("os-filters-categoria")).toBeInTheDocument();
    expect(screen.getByText("Categoria:")).toBeInTheDocument();
  });
});

describe("OsFiltersPanel advanced filters", () => {
  beforeEach(() => {
    categoriasLookup.data = [];
    categoriasLookup.isLoading = false;
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
    categoriasLookup.data = [];
    categoriasLookup.isLoading = false;
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

describe("OsFiltersPanel voltar ao padrão", () => {
  const savedFilters = [
    {
      id: 1,
      nome: "Meu padrão",
      situacoes: [],
      setores: [],
      is_default: true,
    },
    {
      id: 2,
      nome: "Outro",
      situacoes: ["Em Execução"],
      setores: [],
      is_default: false,
    },
  ];

  beforeEach(() => {
    categoriasLookup.data = [];
    categoriasLookup.isLoading = false;
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("oculta o botão quando o filtro selecionado já é o padrão", () => {
    renderPanel(vi.fn(), vi.fn(), {
      savedFilters,
      savedFilterId: "1",
    });
    expect(
      screen.queryByTestId("os-filters-back-to-default"),
    ).not.toBeInTheDocument();
  });

  it("mostra o botão e aplica o filtro padrão quando outro está selecionado", () => {
    const onSavedFilterChange = vi.fn();
    renderPanel(vi.fn(), vi.fn(), {
      savedFilters,
      savedFilterId: "2",
      onSavedFilterChange,
    });
    fireEvent.click(screen.getByTestId("os-filters-back-to-default"));
    expect(onSavedFilterChange).toHaveBeenCalledWith("1");
  });

  it("mostra o botão quando nenhum filtro salvo está selecionado", () => {
    renderPanel(vi.fn(), vi.fn(), {
      savedFilters,
      savedFilterId: "",
    });
    expect(screen.getByTestId("os-filters-back-to-default")).toBeInTheDocument();
  });
});

describe("OsFiltersPanel categoria lookup", () => {
  beforeEach(() => {
    categoriasLookup.data = [];
    categoriasLookup.isLoading = false;
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("desabilita Categoria só no primeiro carregamento sem opções", () => {
    categoriasLookup.isLoading = true;
    renderPanel();
    const trigger = screen.getByTestId("os-filters-categoria");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Carregando...");
  });

  it("mantém Categoria habilitada com opções em cache mesmo recarregando", () => {
    categoriasLookup.data = ["Deputado", "Orgao"];
    categoriasLookup.isLoading = true;
    renderPanel();
    const trigger = screen.getByTestId("os-filters-categoria");
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveTextContent("Todos");
  });
});
