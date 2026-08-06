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

  it("groups machines by chapas qty ascending when enabled", () => {
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
    const { container } = render(
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
    const headings = within(container)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings.indexOf("M2")).toBeLessThan(headings.indexOf("M1"));
    expect(headings[0]).toMatch(/Espelhos de chapa/i);
    const headers = container.querySelectorAll("section > header");
    expect(headers[1]?.textContent).toMatch(/M2/);
    expect(headers[1]?.textContent).toMatch(/1 chapa/);
    expect(headers[2]?.textContent).toMatch(/M1/);
    expect(headers[2]?.textContent).toMatch(/4 chapas/);
  });

  it("shows machine chapas count from files when chapasPorMaquina is empty", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      {
        id: 3,
        nome: "2026_OS 00612-Gr-Outro (Cad 2 A) (C).tif",
        maquina: "SM74",
      },
    ];
    const { container } = render(
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
    const headers = [...container.querySelectorAll("section > header")].map(
      (h) => h.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(headers.some((t) => t?.includes("PM52") && t.includes("2 chapas"))).toBe(
      true,
    );
    expect(headers.some((t) => t?.includes("SM74") && t.includes("1 chapa"))).toBe(
      true,
    );
  });
});
