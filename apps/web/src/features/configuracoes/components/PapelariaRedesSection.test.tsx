import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchPapelariaRedes: vi.fn(),
  savePapelariaRedes: vi.fn(),
  uploadPapelariaRedeLogo: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => api);

import { PapelariaRedesSection } from "./PapelariaRedesSection";

const redes = [
  { chave: "x", nome: "X (Twitter)", exemplo: "@usuario", logo: "x.pdf", logo_url: "/papelaria/redes/x/logo.png", ativo: true },
  { chave: "instagram", nome: "Instagram", exemplo: "@usuario", logo: null, logo_url: null, ativo: true },
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
    api.fetchPapelariaRedes.mockResolvedValue({ redes });
    api.savePapelariaRedes.mockImplementation(async (lista: Array<Record<string, unknown>>) => ({
      redes: lista.map((r) => ({ ...r, logo: null, logo_url: null })),
    }));
    api.uploadPapelariaRedeLogo.mockResolvedValue({ redes });
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
    const botaoLogo = screen.getByRole("button", { name: "Enviar logo de YouTube" });
    expect(botaoLogo).not.toBeDisabled();
    fireEvent.click(botaoLogo);
    const arquivo = new File(["<svg/>"], "youtube.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByTestId("pw-rede-logo-input"), { target: { files: [arquivo] } });
    await vi.waitFor(() => expect(api.uploadPapelariaRedeLogo).toHaveBeenCalledWith("youtube", arquivo));
    expect(api.savePapelariaRedes).toHaveBeenCalledTimes(1);
    expect(api.savePapelariaRedes.mock.calls[0][0].map((r: { chave: string }) => r.chave)).toEqual([
      "x",
      "instagram",
      "youtube",
    ]);
  });
});
