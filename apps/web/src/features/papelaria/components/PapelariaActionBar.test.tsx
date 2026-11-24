import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PapelariaActionBar, type PapelariaActionBarProps } from "./PapelariaActionBar";

function props(over: Partial<PapelariaActionBarProps> = {}): PapelariaActionBarProps {
  return {
    showAbrirPasta: true,
    showTimbradoA4Digital: false,
    showFinalizar: false,
    busy: false,
    folderCheckPending: false,
    modelLoading: false,
    isJobGenerating: false,
    createJobPending: false,
    createDigitalPending: false,
    imposicaoPending: false,
    abrirCorelPending: false,
    abrirPastaPending: false,
    finalizeCorelPending: false,
    hasOs: true,
    selectedModelId: 1,
    canImposicao: true,
    onAbrirPasta: vi.fn(),
    onGerarArquivo: vi.fn(),
    onGerarCorel: vi.fn(),
    onTimbradoA4Digital: vi.fn(),
    onAbrirCorel: vi.fn(),
    onFinalizarCorel: vi.fn(),
    onImposicao: vi.fn(),
    ...over,
  };
}

describe("PapelariaActionBar", () => {
  it("em linha: botões lado a lado, na ordem de uso", () => {
    render(<PapelariaActionBar {...props({ orientacao: "linha" })} />);
    const barra = screen.getByTestId("papelaria-action-bar");
    expect(barra).toHaveAttribute("data-orientacao", "linha");
    expect(barra.className).toContain("flex-row");
    const rotulos = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rotulos).toEqual(["Abrir pasta", "Criar prova", "Gerar Corel", "Abrir Corel", "Imposição"]);
  });

  it("padrão continua em coluna", () => {
    render(<PapelariaActionBar {...props()} />);
    const barra = screen.getByTestId("papelaria-action-bar");
    expect(barra).toHaveAttribute("data-orientacao", "coluna");
    expect(barra.className).toContain("flex-col");
  });

  it("ocultarCriarProva tira «Criar prova» da linha (fica flutuante na prévia)", () => {
    render(<PapelariaActionBar {...props({ orientacao: "linha", ocultarCriarProva: true })} />);
    const rotulos = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rotulos).toEqual(["Abrir pasta", "Gerar Corel", "Abrir Corel", "Imposição"]);
  });
});
