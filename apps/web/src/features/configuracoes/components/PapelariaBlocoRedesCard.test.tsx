import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchPapelariaRedes: vi.fn(),
  detectarBlocoRedes: vi.fn(),
  salvarBlocoRedes: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => ({ fetchPapelariaRedes: api.fetchPapelariaRedes }));
vi.mock("@/api/papelariaProvaPdf", () => ({
  detectarBlocoRedes: api.detectarBlocoRedes,
  salvarBlocoRedes: api.salvarBlocoRedes,
}));

import { PapelariaBlocoRedesCard } from "./PapelariaBlocoRedesCard";

const textos = ["@rodrigo.rollemberg", "RollembergPSB", "Nome do deputado"].map((m) => ({
  marcador: m,
  pagina: 1,
  fonte: "StoneSansStd-Medium",
  tamanho: 7,
  cor: "0 g",
  x_mm: 0,
  y_mm: 0,
  alinhamento_sugerido: "esquerda" as const,
  ancora_sugerida: "topo" as const,
}));

const detectado = {
  ativo: true,
  pagina: 1,
  area: [33, 30, 207, 111] as [number, number, number, number],
  marcadores: ["@rodrigo.rollemberg", "RollembergPSB"],
  fonte_marcador: "@rodrigo.rollemberg",
  disposicao: "vertical" as const,
  alinhamento_h: "centro" as const,
  alinhamento_v: "meio" as const,
  icone_mm: 3.72,
  espaco_mm: 1.28,
  gap_mm: 0.8,
  max: 2,
  permitidas: [],
};

describe("PapelariaBlocoRedesCard", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchPapelariaRedes.mockResolvedValue({
      redes: [
        { chave: "tiktok", nome: "TikTok", exemplo: "@u", logo: "tiktok.pdf", logo_url: null, ativo: true },
        { chave: "x", nome: "X", exemplo: "@u", logo: null, logo_url: null, ativo: true },
      ],
    });
    api.detectarBlocoRedes.mockResolvedValue(detectado);
    api.salvarBlocoRedes.mockResolvedValue({ tem_pdf: true, campos: [], redes: detectado, analise: null });
  });

  it("cria o bloco pelas linhas marcadas, ajusta e salva", async () => {
    const onSalvo = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PapelariaBlocoRedesCard modeloId={7} textos={textos} bloco={null} onSalvo={onSalvo} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText(/@rodrigo.rollemberg/));
    fireEvent.click(screen.getByLabelText(/RollembergPSB/));
    fireEvent.click(screen.getByRole("button", { name: /Criar bloco com 2/ }));
    await vi.waitFor(() =>
      expect(api.detectarBlocoRedes).toHaveBeenCalledWith(7, 1, ["@rodrigo.rollemberg", "RollembergPSB"]),
    );
    expect(await screen.findByTestId("pw-redes-config")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Grade (2 col.)" }));
    fireEvent.click(await screen.findByText("X"));
    fireEvent.click(screen.getByRole("button", { name: /Salvar bloco/ }));
    await vi.waitFor(() => expect(api.salvarBlocoRedes).toHaveBeenCalled());
    const enviado = api.salvarBlocoRedes.mock.calls[0][1];
    expect(enviado.disposicao).toBe("grade");
    expect(enviado.permitidas).toEqual(["tiktok"]);
    await vi.waitFor(() => expect(onSalvo).toHaveBeenCalled());
  });
});
