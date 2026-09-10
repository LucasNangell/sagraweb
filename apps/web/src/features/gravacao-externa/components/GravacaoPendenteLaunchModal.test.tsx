import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteLaunchModal } from "./GravacaoPendenteLaunchModal";

const inspectNetworkFiles = vi.fn();
const loadNetworkFilePreviewBlobUrl = vi.fn();
const correctNetworkGraphics = vi.fn();

vi.mock("@/api/auxLookups", () => ({
  fetchMaquinas: () => Promise.resolve(["KOMORI"]),
}));

vi.mock("@/api/gravacaoPendente", () => ({
  fetchGravacaoPendenteChapasEstimate: () =>
    Promise.resolve({ fonte: "pdf", total_chapas: 1, pdf_page_count: 1 }),
}));

vi.mock("@/api/os", () => ({
  fetchOsDetails: () => Promise.resolve({}),
}));

vi.mock("@/api/networkFiles", () => ({
  correctNetworkGraphics: (...args: unknown[]) => correctNetworkGraphics(...args),
  inspectNetworkFiles: (...args: unknown[]) => inspectNetworkFiles(...args),
  loadNetworkFilePreviewBlobUrl: (...args: unknown[]) => loadNetworkFilePreviewBlobUrl(...args),
}));

vi.mock("./NetworkFolderBrowserModal", () => ({
  NetworkFolderBrowserModal: () => null,
}));

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GravacaoPendenteLaunchModal
        open
        mode="edit"
        row={{ nr_os: 801, ano: 2026 } as never}
        initialChapas={[{ maquina: "KOMORI", quantidade: 1 }]}
        initialArquivos={[
          {
            absolute_path: String.raw`\\server\share\espelho.pdf`,
            nome: "espelho.pdf",
            maquina: "KOMORI",
          },
          {
            absolute_path: String.raw`\\server\share\placa (C).tif`,
            nome: "placa (C).tif",
            maquina: "KOMORI",
          },
        ]}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("GravacaoPendenteLaunchModal preview e inspeção", () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
    inspectNetworkFiles.mockReset();
    correctNetworkGraphics.mockReset();
    inspectNetworkFiles.mockResolvedValue({
      files: [
        {
          absolute_path: String.raw`\\server\share\placa (C).tif`,
          nome: "placa (C).tif",
          type: "tif",
          status: "done",
          preview_mime: "image/png",
          graphics_status: "blank_graphics",
          blank_graphics: true,
          maquina: "KOMORI",
          cor: "C",
          inspection_token: "a".repeat(64),
          feedback_revision: 0,
          reason: "Apenas marcas de registro/calibragem detectadas.",
        },
      ],
    });
    loadNetworkFilePreviewBlobUrl.mockReset();
    loadNetworkFilePreviewBlobUrl.mockResolvedValue("blob:preview");
  });

  it("mostra alerta de TIFF sem grafismo e carrega preview ao selecionar arquivo", async () => {
    renderModal();

    expect(screen.getByText("Selecione um PDF ou TIF para visualizar.")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("1 TIF sem grafismo detectado.")).toBeInTheDocument();
    });
    expect(screen.getByText("Sem grafismo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "placa (C).tif Sem grafismo" }));

    await waitFor(() => {
      expect(loadNetworkFilePreviewBlobUrl).toHaveBeenCalledWith(
        {
          absolute_path: String.raw`\\server\share\placa (C).tif`,
          nome: "placa (C).tif",
        },
        expect.any(AbortSignal),
      );
    });
  });

  it("salva correção com máquina e versão, atualiza alerta e inverte o botão", async () => {
    correctNetworkGraphics.mockImplementation(async (input) => {
      const updated = {
        absolute_path: input.absolute_path, nome: "placa (C).tif", maquina: input.maquina,
        cor: "C", type: "tif", status: "done", blank_graphics: input.blank_graphics,
        inspection_token: input.inspection_token, feedback_revision: 1,
        detection_source: "feedback",
      };
      inspectNetworkFiles.mockResolvedValue({ files: [updated] });
      return updated;
    });
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: "placa (C).tif Sem grafismo" }));
    const correct = await screen.findByRole("button", { name: "Possui grafismo" });
    await waitFor(() => expect(correct).toBeEnabled());
    fireEvent.click(correct);
    await waitFor(() => expect(correctNetworkGraphics).toHaveBeenCalledWith(
      expect.objectContaining({ maquina: "KOMORI", blank_graphics: false,
        inspection_token: "a".repeat(64), feedback_revision: 0 }),
      expect.anything(),
    ));
    await waitFor(() => expect(screen.queryByText("1 TIF sem grafismo detectado.")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Não possui grafismo" })).toBeInTheDocument();
    expect(screen.getByText("Correção salva para o aprendizado.")).toBeInTheDocument();
    expect(loadNetworkFilePreviewBlobUrl).toHaveBeenCalledTimes(1);
  });

  it("exibe falha ao salvar e preserva a classificação", async () => {
    correctNetworkGraphics.mockRejectedValue(new Error("Não foi possível salvar a correção."));
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: "placa (C).tif Sem grafismo" }));
    const button = await screen.findByRole("button", { name: "Possui grafismo" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText("Não foi possível salvar a correção.")).toBeInTheDocument();
    expect(screen.getByText("1 TIF sem grafismo detectado.")).toBeInTheDocument();
  });

  it("não oferece correção de grafismo para PDF", async () => {
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: "espelho.pdf" }));
    await screen.findByTitle("Preview espelho.pdf");
    expect(screen.queryByRole("button", { name: "Possui grafismo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Não possui grafismo" })).not.toBeInTheDocument();
  });

  it("refaz a inspeção usando a nova máquina", async () => {
    renderModal();
    await screen.findByText("1 TIF sem grafismo detectado.");
    const machine = screen.getByDisplayValue("KOMORI");
    fireEvent.change(machine, { target: { value: "SM74" } });
    await waitFor(() => expect(inspectNetworkFiles).toHaveBeenLastCalledWith([
      expect.objectContaining({ maquina: "SM74" }),
    ], expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });
});
