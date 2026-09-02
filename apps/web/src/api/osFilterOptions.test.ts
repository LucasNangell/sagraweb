import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/api/client";
import { fetchOsFilterFormatos, fetchOsFilterRequesters } from "./osFilterOptions";

describe("fetchOsFilterRequesters", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({ data: [] });
  });

  it("serializa categorias na query", async () => {
    await fetchOsFilterRequesters("mar", 30, undefined, ["Deputado", "Senado"]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    expect(url).toContain("/os/filter-options/requesters?");
    expect(url).toContain("q=mar");
    expect(url).toContain("categorias=Deputado");
    expect(url).toContain("categorias=Senado");
  });

  it("omite categorias quando vazio", async () => {
    await fetchOsFilterRequesters("jo", 30);
    const url = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    expect(url).not.toContain("categorias=");
  });
});

describe("fetchOsFilterFormatos", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({ data: [] });
  });

  it("chama GET /os/filter-options/formatos", async () => {
    await fetchOsFilterFormatos("a4", 30);
    const url = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    expect(url).toContain("/os/filter-options/formatos?");
    expect(url).toContain("q=a4");
    expect(url).toContain("limit=30");
  });
});
