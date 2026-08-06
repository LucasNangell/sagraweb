import { describe, expect, it, vi } from "vitest";

import { refetchActiveOsSearchList, useOsActiveSearchStore } from "./osActiveSearchStore";
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

describe("osActiveSearchStore", () => {
  it("refetchActiveOsSearchList chama refetch registrado", async () => {
    const refetch = vi.fn(async () => ({ data: [], meta: { page: 1, limit: 50 } }));
    useOsActiveSearchStore.getState().register(sampleFilters, refetch);

    const ok = await refetchActiveOsSearchList();

    expect(ok).toBe(true);
    expect(refetch).toHaveBeenCalledOnce();

    useOsActiveSearchStore.getState().clear();
  });

  it("refetchActiveOsSearchList retorna false sem registro", async () => {
    useOsActiveSearchStore.getState().clear();
    await expect(refetchActiveOsSearchList()).resolves.toBe(false);
  });
});
