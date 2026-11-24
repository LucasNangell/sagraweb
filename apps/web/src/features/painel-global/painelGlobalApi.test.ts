import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  appStaticUrl: (path: string) => `/${path}`,
}));

import { apiFetch } from "@/lib/api";
import {
  fetchPainelQueueBySetor,
  fetchPainelVolumeDrill,
  fetchPainelVolumeMensal,
} from "./painelGlobalApi";

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  apiFetchMock.mockReset();
});

describe("painelGlobalApi", () => {
  it("fetchPainelQueueBySetor envia painel=1", async () => {
    apiFetchMock.mockResolvedValueOnce({ items: [{ nr_os: 1, ano: 2026 }] });

    const items = await fetchPainelQueueBySetor("SEFOC");

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const url = String(apiFetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/pcp/queue?");
    expect(url).toContain("setor=SEFOC");
    expect(url).toContain("painel=1");
    expect(items[0]?.fetchedSector).toBe("SEFOC");
  });

  it("fetchPainelVolumeMensal chama /os/volume-mensal", async () => {
    apiFetchMock.mockResolvedValueOnce({
      ano: 2026,
      months: [{ month: 1, em_andamento: 3, entregue: 1, cancelado: 0 }],
    });

    const months = await fetchPainelVolumeMensal(2026, {
      includeOs: true,
      includeSp: false,
    });

    const url = String(apiFetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/os/volume-mensal?");
    expect(url).toContain("ano=2026");
    expect(url).toContain("include_os=true");
    expect(url).toContain("include_sp=false");
    expect(months).toHaveLength(1);
    expect(months[0]?.em_andamento).toBe(3);
  });

  it("fetchPainelVolumeDrill chama /os/volume-mensal/drill", async () => {
    apiFetchMock.mockResolvedValueOnce({
      ano: 2026,
      month: 2,
      category: "em_andamento",
      rows: [{ setor: "SEFOC", produto: "", situacao: "Em Execução" }],
    });

    const rows = await fetchPainelVolumeDrill(2026, 2, "em_andamento", {
      setor: "SEFOC",
    });

    const url = String(apiFetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/os/volume-mensal/drill?");
    expect(url).toContain("month=2");
    expect(url).toContain("category=em_andamento");
    expect(url).toContain("setor=SEFOC");
    expect(rows[0]?.setor).toBe("SEFOC");
  });
});
