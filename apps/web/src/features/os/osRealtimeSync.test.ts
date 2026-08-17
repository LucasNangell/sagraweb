import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OsSearchFilters } from "./types";

const sampleFilters: OsSearchFilters = {
  nrOs: undefined,
  anos: [2026],
  produto: "",
  produtos: [],
  titulo: "",
  processo: "",
  solicitante: "",
  solicitantes: [],
  categorias: [],
  maquinas: [],
  situacao: ["Em Andamento"],
  setor: [],
  prioridade: [],
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: 50,
};

const refetchMock = vi.fn(async () => ({ data: [], meta: { page: 1, limit: 50 } }));

vi.mock("./osActiveSearchStore", () => ({
  getActiveOsSearchFilters: () => sampleFilters,
  refetchActiveOsSearchList: () => refetchMock(),
}));

vi.mock("./osSearchRefreshLock", () => ({
  tryAcquireOsSearchRefreshLock: () => true,
}));

vi.mock("@/api/os", () => ({
  searchOs: vi.fn(),
  fetchOsDetails: vi.fn(),
  fetchOsHistory: vi.fn(),
  fetchSubOsList: vi.fn(),
}));

describe("silentRefreshOsSearch coalesce", () => {
  beforeEach(async () => {
    refetchMock.mockClear();
    refetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ data: [], meta: { page: 1, limit: 50 } }),
            40,
          );
        }),
    );
    const { resetSilentOsSearchRefreshStateForTests } = await import(
      "./osRealtimeSync"
    );
    resetSilentOsSearchRefreshStateForTests();
  });

  afterEach(async () => {
    const { resetSilentOsSearchRefreshStateForTests } = await import(
      "./osRealtimeSync"
    );
    resetSilentOsSearchRefreshStateForTests();
    vi.clearAllMocks();
  });

  it("coalesce: varios pedidos em paralelo disparam no maximo 2 refetch (in-flight + trailing)", async () => {
    const { silentRefreshOsSearch } = await import("./osRealtimeSync");
    const qc = new QueryClient();

    const p1 = silentRefreshOsSearch(qc, sampleFilters, {
      skipCrossTabLock: true,
    });
    const p2 = silentRefreshOsSearch(qc, sampleFilters, {
      skipCrossTabLock: true,
    });
    const p3 = silentRefreshOsSearch(qc, sampleFilters, {
      skipCrossTabLock: true,
    });

    await Promise.all([p1, p2, p3]);

    // 1ª execução + no máximo 1 trailing após queue
    expect(refetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(refetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
