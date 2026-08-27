import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyGerenciaForm } from "../defaults";
import { createEmptyTechSpec } from "../techSpec";
import type { GerenciaFormState } from "../types";
import { GerenciaFormGrid } from "./GerenciaFormGrid";
import { GERENCIA_SECTIONS } from "./GerenciaFormSections";

function renderGrid(formPatch: Partial<GerenciaFormState> = {}) {
  render(
    <GerenciaFormGrid
      form={{ ...createEmptyGerenciaForm(), ...formPatch }}
      update={vi.fn()}
      readOnly={false}
      categorias={[]}
      produtos={[]}
      maquinas={[]}
      papeis={[]}
      cores={[]}
      formatos={[]}
      formasEntrega={[]}
      responsaveisGrafica={[]}
      acabamentos={[]}
      techSpec={createEmptyTechSpec()}
      onTechSpecChange={vi.fn()}
    />,
  );
}

describe("GerenciaFormGrid", () => {
  it("alinha a nav do modal à ordem da página", () => {
    expect(GERENCIA_SECTIONS.map((s) => s.id)).toEqual([
      "solicitante",
      "ordem",
      "material",
      "elementos",
      "entrega",
      "tecnicos",
      "custos",
    ]);
  });

  it("coloca Material e Elementos entre Ordem e Entrega", () => {
    renderGrid();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((el) => el.textContent);

    expect(headings).toEqual([
      "Informações do Solicitante",
      "Ordem de Produção",
      "Material Entregue",
      "Elementos Gráficos",
      "Entrega",
      "Detalhes Técnicos",
      "Cálculos de cota",
    ]);
  });

  it("não mostra o botão Orçamento sem permissão ctx_orcamento", () => {
    renderGrid();
    expect(
      screen.queryByRole("link", { name: "Orçamento" }),
    ).not.toBeInTheDocument();
  });

  it("usa checks compactos em Elementos na página", () => {
    renderGrid();

    expect(
      screen.queryByText("Selecione os elementos institucionais:"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Brasão")).toBeInTheDocument();
    expect(screen.getByLabelText("Timbre")).toBeInTheDocument();
    expect(screen.getByLabelText("Arte Gab.")).toBeInTheDocument();
    expect(screen.getByLabelText("Assinatura")).toBeInTheDocument();
    expect(screen.getByLabelText("Amostra")).toBeInTheDocument();
    expect(screen.getByLabelText("Insumos Fornecidos")).toBeInTheDocument();
  });

  it("mostra Acabamentos à esquerda de Obs em Detalhes Técnicos", () => {
    renderGrid();
    expect(screen.getByLabelText("Acabamentos")).toBeInTheDocument();
    expect(screen.getByLabelText("Obs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Acabamento")).not.toBeInTheDocument();
  });

  it("torna Data Entrega obrigatória quando a prioridade não é Normal", () => {
    renderGrid({ val_prioridade: "Solicitado p/" });
    const field = screen.getByLabelText(/Data Entrega/);
    expect(field).toHaveAttribute("required");
    expect(field).toHaveAttribute("aria-required", "true");
  });

  it("não exige Data Entrega quando a prioridade é Normal", () => {
    renderGrid();
    const field = screen.getByLabelText("Data Entrega");
    expect(field).not.toHaveAttribute("required");
  });

  it("mantém Formato, Altura e Largura na mesma linha de Produto e Qt. Modelos", () => {
    renderGrid();
    const produto = screen.getByLabelText("Produto");
    const modelos = screen.getByLabelText("Qt. Modelos");
    const formato = screen.getByLabelText("Formato");
    const altura = screen.getByLabelText("Altura (mm)");
    const largura = screen.getByLabelText("Largura (mm)");
    expect(
      produto.compareDocumentPosition(modelos) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      modelos.compareDocumentPosition(formato) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      formato.compareDocumentPosition(altura) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      altura.compareDocumentPosition(largura) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(produto.closest(".grid")).toBe(formato.closest(".grid"));
  });
});
