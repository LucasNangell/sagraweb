import { beforeEach, describe, expect, it } from "vitest";

import { defaultOsFilters, useOsFiltersStore } from "./osFiltersStore";
import { sortsToFilterPatch } from "./osSortKeys";

const STORAGE_KEY = "sagra-os-filter-toggles";

const queuedSorts = [
  { column: "ano" as const, dir: "desc" as const },
  { column: "nr_os" as const, dir: "desc" as const },
];

describe("osFiltersStore persistência de ordenação", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useOsFiltersStore.setState({
      filters: defaultOsFilters(),
      globalSearch: "",
      filtersExpanded: true,
    });
  });

  it("Limpar filtros não zera a fila de ordenação", () => {
    useOsFiltersStore.getState().patchFilters({
      situacao: ["Em Execução"],
      ...sortsToFilterPatch(queuedSorts),
    });
    useOsFiltersStore.getState().resetFilters();
    const { filters } = useOsFiltersStore.getState();
    expect(filters.situacao).toEqual([]);
    expect(filters.sorts).toEqual(queuedSorts);
    expect(filters.sortBy).toBe("ano");
    expect(filters.sortDir).toBe("desc");
  });

  it("merge restaura sorts persistidos", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          filters: {
            includeOs: true,
            includeSp: false,
            sorts: queuedSorts,
            sortBy: "ano",
            sortDir: "desc",
          },
        },
        version: 0,
      }),
    );
    await useOsFiltersStore.persist.rehydrate();
    const { filters } = useOsFiltersStore.getState();
    expect(filters.sorts).toEqual(queuedSorts);
    expect(filters.sortBy).toBe("ano");
    expect(filters.sortDir).toBe("desc");
    expect(filters.includeSp).toBe(false);
  });
});
