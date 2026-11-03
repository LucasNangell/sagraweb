import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { gravacaoExternaCompositePreviewUrl } from "@/api/gravacaoExterna";
import { gravacaoPendenteCompositePreviewUrl } from "@/api/gravacaoPendente";
import { GravacaoExternaArquivosPanel } from "@/features/gravacao-externa/components/GravacaoExternaPreview";

const GROUP_KEY =
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A)";

function expandFirstCaderno() {
  const cadernoBtn = screen.getByRole("button", { name: /Cad 1/i });
  fireEvent.click(cadernoBtn);
}

describe("composite preview", () => {
  it("builds externa composite URL with encoded group_key", () => {
    const url = gravacaoExternaCompositePreviewUrl(2024, 1857, GROUP_KEY);
    const expectedQuery = new URLSearchParams({ group_key: GROUP_KEY }).toString();
    expect(url).toBe(`/api/gravacao-externa/2024/1857/preview-composite?${expectedQuery}`);
  });

  it("builds pendente composite URL with encoded group_key", () => {
    const url = gravacaoPendenteCompositePreviewUrl(2024, 1857, GROUP_KEY);
    const expectedQuery = new URLSearchParams({ group_key: GROUP_KEY }).toString();
    expect(url).toBe(`/api/gravacao-pendente/2024/1857/preview-composite?${expectedQuery}`);
  });

  it("keeps cadernos collapsed when there is no selection", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif` },
      { id: 2, nome: `${GROUP_KEY} (M).tif` },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /Cad 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comp\./i })).not.toBeInTheDocument();
    expect(screen.queryByText(`${GROUP_KEY} (C).tif`)).not.toBeInTheDocument();
  });

  it("shows Comp. chip when chapa has at least 2 separations", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif` },
      { id: 2, nome: `${GROUP_KEY} (M).tif` },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expandFirstCaderno();
    expect(screen.getByText("Frente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Comp\./i })).toBeInTheDocument();
  });

  it("hides Comp. when chapa has only one separation", () => {
    const arquivos = [{ id: 1, nome: `${GROUP_KEY} (C).tif` }];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expandFirstCaderno();
    expect(screen.queryByRole("button", { name: /Comp\./i })).not.toBeInTheDocument();
  });

  it("hides missing CMYK rows instead of showing indisponivel", () => {
    const arquivos = [{ id: 1, nome: `${GROUP_KEY} (K).tif` }];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expandFirstCaderno();
    expect(screen.getByText(`${GROUP_KEY} (K).tif`)).toBeInTheDocument();
    expect(screen.queryByText(/C — indisponivel/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/M — indisponivel/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Y — indisponivel/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comp\./i })).not.toBeInTheDocument();
  });

  it("shows Espelhos de chapa section for PDF files before TIF chapas", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif` },
      { id: 2, nome: "espelho-completo.pdf" },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const espelhosBtn = screen.getByRole("button", { name: /Espelhos de chapa/i });
    const cadernoBtn = screen.getByRole("button", { name: /Cad 1/i });
    expect(espelhosBtn).toBeInTheDocument();
    expect(screen.getByText("espelho-completo.pdf")).toBeInTheDocument();
    expect(
      espelhosBtn.compareDocumentPosition(cadernoBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("nests Frente and Verso under a single Cad card", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif` },
      { id: 2, nome: `${GROUP_KEY} (M).tif` },
      {
        id: 3,
        nome: "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 B) (C).tif",
      },
      {
        id: 4,
        nome: "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 B) (M).tif",
      },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /Cad 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cad 1 A/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cad 1 B/i })).not.toBeInTheDocument();
    expandFirstCaderno();
    expect(screen.getByText("Frente")).toBeInTheDocument();
    expect(screen.getByText("Verso")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Comp\./i })).toHaveLength(2);
  });

  it("shows PANTONE chip inside the same caderno as CMYK", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif` },
      { id: 2, nome: `${GROUP_KEY} (M).tif` },
      { id: 3, nome: `${GROUP_KEY} (Pantone 185).tif` },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expandFirstCaderno();
    expect(screen.getByText("PANTONE")).toBeInTheDocument();
    expect(screen.getByText(`${GROUP_KEY} (Pantone 185).tif`)).toBeInTheDocument();
    expect(screen.queryByText("Outros")).not.toBeInTheDocument();
  });

  it("shows machine filter options ordered by chapas qty ascending", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "M1" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "M1" },
      {
        id: 3,
        nome: "2026_OS 00612-Gr-Outro (Cad 2 A) (C).tif",
        maquina: "M2",
      },
      { id: 4, nome: "espelho.pdf", maquina: null },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        groupByMachine
        chapasPorMaquina={[
          { maquina: "M1", quantidade: 4 },
          { maquina: "M2", quantidade: 1 },
        ]}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    const buttons = within(filter).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Espelhos", "M2", "M1"]);
    fireEvent.click(within(filter).getByRole("button", { name: "M2" }));
    expect(screen.getByTestId("machine-filter-chapas-count")).toHaveTextContent("1 chapa");
    fireEvent.click(within(filter).getByRole("button", { name: "M1" }));
    expect(screen.getByTestId("machine-filter-chapas-count")).toHaveTextContent("4 chapas");
  });

  it("filters the file list when a machine segment is selected", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "Komori" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "Komori" },
      {
        id: 3,
        nome: "2026_OS 00612-Gr-Outro (Cad 2 A) (C).tif",
        maquina: "SM74",
      },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        groupByMachine
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    expect(within(filter).getByRole("button", { name: "Komori" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Cad 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cad 2/i })).not.toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "SM74" }));
    expect(screen.getByRole("button", { name: /Cad 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cad 1/i })).not.toBeInTheDocument();
  });

  it("hides machine filter when only one machine has files", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        groupByMachine
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("group", { name: /Filtrar arquivos por máquina/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cad 1/i })).toBeInTheDocument();
  });

  it("shows chapas count from files when chapasPorMaquina is empty", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      {
        id: 3,
        nome: "2026_OS 00612-Gr-Outro (Cad 2 A) (C).tif",
        maquina: "SM74",
      },
    ];
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        groupByMachine
        chapasPorMaquina={[]}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    // Natural name order with empty chapasPorMaquina: PM52 before SM74
    expect(screen.getByTestId("machine-filter-chapas-count")).toHaveTextContent("2 chapas");
    fireEvent.click(screen.getByRole("button", { name: "SM74" }));
    expect(screen.getByTestId("machine-filter-chapas-count")).toHaveTextContent("1 chapa");
  });
});
