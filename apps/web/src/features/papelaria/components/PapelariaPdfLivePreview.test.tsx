import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
      paginas: [`data:image/png;base64,${dados["nome_deputado"] ?? ""}`],
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
    expect(api.previaPdfAoVivo.mock.calls[0]![0]).toBe(7);

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

describe("PapelariaPdfLivePreview — edição de texto", () => {
  beforeEach(() => {
    api.previaPdfAoVivo.mockReset();
    api.previaPdfAoVivo.mockResolvedValue({
      paginas: ["data:image/png;base64,AAA"],
      ms: 5,
      regioes: [
        {
          chave: "7:1:NOME",
          modelo_id: 7,
          pagina: 1,
          pagina_saida: 0,
          marcador: "NOME",
          area: [0.1, 0.2, 0.6, 0.3],
          texto: "Ana",
          negrito: [],
          template: "{nome_deputado}",
          valores: { nome_deputado: "Ana" },
          editado: false,
        },
      ],
    });
  });

  function renderEditavel(onEditarTexto = vi.fn(), onRestaurarTexto = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PapelariaPdfLivePreview
          modeloId={7}
          values={{ nome_deputado: "Ana" }}
          onEditarTexto={onEditarTexto}
          onRestaurarTexto={onRestaurarTexto}
        />
      </QueryClientProvider>,
    );
    return { onEditarTexto, onRestaurarTexto };
  }

  it("clicar no texto abre o editor e Enter aplica", async () => {
    const { onEditarTexto } = renderEditavel();
    fireEvent.click(await screen.findByRole("button", { name: "Editar texto: Ana" }));
    const campo = screen.getByRole("textbox", { name: "Texto" });
    expect(campo).toHaveValue("Ana");
    fireEvent.change(campo, { target: { value: "Ana Maria" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onEditarTexto).toHaveBeenCalledWith(expect.objectContaining({ chave: "7:1:NOME" }), "Ana Maria");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc cancela sem aplicar", async () => {
    const { onEditarTexto } = renderEditavel();
    fireEvent.click(await screen.findByRole("button", { name: "Editar texto: Ana" }));
    const campo = screen.getByRole("textbox", { name: "Texto" });
    fireEvent.change(campo, { target: { value: "X" } });
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(onEditarTexto).not.toHaveBeenCalled();
  });

  it("texto editado oferece restaurar o original", async () => {
    api.previaPdfAoVivo.mockResolvedValue({
      paginas: ["data:image/png;base64,AAA"],
      ms: 5,
      regioes: [
        {
          chave: "7:1:NOME",
          modelo_id: 7,
          pagina: 1,
          pagina_saida: 0,
          marcador: "NOME",
          area: [0.1, 0.2, 0.6, 0.3],
          texto: "Livre",
          negrito: [],
          template: "",
          valores: {},
          editado: true,
        },
      ],
    });
    const { onRestaurarTexto } = renderEditavel();
    fireEvent.click(await screen.findByRole("button", { name: "Editar texto: Livre" }));
    fireEvent.click(screen.getByRole("button", { name: /Restaurar original/ }));
    expect(onRestaurarTexto).toHaveBeenCalledWith(expect.objectContaining({ chave: "7:1:NOME" }));
  });

  it("sem callback de edição não mostra as áreas clicáveis", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PapelariaPdfLivePreview modeloId={7} values={{}} />
      </QueryClientProvider>,
    );
    await screen.findByAltText("Prévia da página 1");
    expect(screen.queryByTestId("papelaria-previa-regiao")).not.toBeInTheDocument();
  });
});
