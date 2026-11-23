import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ previaPdfAoVivo: vi.fn() }));
vi.mock("@/api/papelariaProvaPdf", () => api);

import { PapelariaPdfLivePreview } from "./PapelariaPdfLivePreview";

function renderPreview(values: Record<string, string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (v: Record<string, string>) => (
    <QueryClientProvider client={qc}>
      <PapelariaPdfLivePreview modeloId={7} values={v} />
    </QueryClientProvider>
  );
  const r = render(ui(values));
  return { ...r, update: (v: Record<string, string>) => r.rerender(ui(v)) };
}

describe("PapelariaPdfLivePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.previaPdfAoVivo.mockReset();
    api.previaPdfAoVivo.mockImplementation(async (_id: number, dados: Record<string, string>) => ({
      paginas: [`data:image/png;base64,${dados.nome_deputado ?? ""}`],
      ms: 10,
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("renderiza o PDF do modelo com os valores do formulário (com debounce)", async () => {
    const { update } = renderPreview({ nome_deputado: "Ana" });
    expect(await screen.findByAltText("Prévia da página 1")).toHaveAttribute(
      "src",
      "data:image/png;base64,Ana",
    );
    expect(api.previaPdfAoVivo).toHaveBeenCalledTimes(1);
    expect(api.previaPdfAoVivo.mock.calls[0][0]).toBe(7);

    update({ nome_deputado: "Ana M" });
    update({ nome_deputado: "Ana Maria" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(await screen.findByAltText("Prévia da página 1")).toHaveAttribute(
      "src",
      "data:image/png;base64,Ana Maria",
    );
    // Digitação rápida gera uma única requisição nova.
    expect(api.previaPdfAoVivo).toHaveBeenCalledTimes(2);
  });

  it("mostra o erro do servidor quando não há prévia anterior", async () => {
    api.previaPdfAoVivo.mockRejectedValue(new Error("A fonte não tem os caracteres ŵ"));
    renderPreview({ nome_deputado: "ŵ" });
    expect(await screen.findByText(/A fonte não tem os caracteres/)).toBeInTheDocument();
  });
});
