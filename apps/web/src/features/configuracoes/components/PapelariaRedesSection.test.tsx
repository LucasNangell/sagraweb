import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchPapelariaRedes: vi.fn(),
  savePapelariaRedes: vi.fn(),
  uploadPapelariaRedeLogo: vi.fn(),
  removerPapelariaRedeLogo: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => api);

import { PapelariaRedesSection } from "./PapelariaRedesSection";

const redes = [
  {
    chave: "x",
    nome: "X (Twitter)",
    exemplo: "@usuario",
    logo: "x__pb.pdf",
    logos: { pb: "x__pb.pdf" },
    logo_url: "/papelaria/redes/x/logo.png",
    logos_url: { pb: "/papelaria/redes/x/logo.png?estilo=pb" },
    ativo: true,
  },
  { chave: "instagram", nome: "Instagram", exemplo: "@usuario", logo: null, logos: {}, logo_url: null, logos_url: {}, ativo: true },
];

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PapelariaRedesSection />
    </QueryClientProvider>,
  );
}

describe("PapelariaRedesSection", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchPapelariaRedes.mockResolvedValue({ redes, estilos: undefined });
    api.savePapelariaRedes.mockImplementation(async (lista: Array<Record<string, unknown>>) => ({
      redes: lista.map((r) => ({ ...r, logo: null, logos: {}, logo_url: null, logos_url: {} })),
    }));
    api.uploadPapelariaRedeLogo.mockResolvedValue({ redes });
    api.removerPapelariaRedeLogo.mockResolvedValue({ redes });
  });

  it("salva com a rede X (identificador de 1 letra) sem erro", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("Exemplo de instagram"), { target: { value: "@perfil" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    await vi.waitFor(() => expect(api.savePapelariaRedes).toHaveBeenCalled());
    expect(screen.queryByText(/Preencha o nome/)).not.toBeInTheDocument();
  });

  it("nova rede: enviar o logo salva a lista antes e depois envia o arquivo", async () => {
    renderSection();
    await screen.findByLabelText("Exemplo de instagram");
    fireEvent.click(screen.getByRole("button", { name: /Nova rede/ }));
    fireEvent.change(screen.getByLabelText("Nome da rede nova"), { target: { value: "YouTube" } });
    const botaoLogo = screen.getByRole("button", { name: "Enviar logo PB de YouTube" });
    expect(botaoLogo).not.toBeDisabled();
    fireEvent.click(botaoLogo);
    const arquivo = new File(["<svg/>"], "youtube.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByTestId("pw-rede-logo-input"), { target: { files: [arquivo] } });
    await vi.waitFor(() => expect(api.uploadPapelariaRedeLogo).toHaveBeenCalledWith("youtube", arquivo, "pb"));
    expect(api.savePapelariaRedes).toHaveBeenCalledTimes(1);
    expect(api.savePapelariaRedes.mock.calls[0]![0].map((r: { chave: string }) => r.chave)).toEqual([
      "x",
      "instagram",
      "youtube",
    ]);
  });
});


describe("PapelariaRedesSection · estilos", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchPapelariaRedes.mockResolvedValue({ redes, estilos: undefined });
    api.removerPapelariaRedeLogo.mockResolvedValue({ redes });
  });

  it("mostra os 4 estilos por rede e remove só o logo de um estilo", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();
    const linha = await screen.findByTestId("pw-rede-x");
    for (const rotulo of ["Quadrado policromia", "Quadrado PB", "Policromia", "PB"]) {
      expect(within(linha).getByText(rotulo)).toBeInTheDocument();
    }
    expect(within(linha).getByRole("button", { name: "Trocar logo PB de X (Twitter)" })).toBeInTheDocument();
    expect(within(linha).getByRole("button", { name: "Enviar logo Policromia de X (Twitter)" })).toBeInTheDocument();
    fireEvent.click(within(linha).getByRole("button", { name: "Remover logo PB de X (Twitter)" }));
    await vi.waitFor(() => expect(api.removerPapelariaRedeLogo).toHaveBeenCalledWith("x", "pb"));
    confirm.mockRestore();
  });
});
