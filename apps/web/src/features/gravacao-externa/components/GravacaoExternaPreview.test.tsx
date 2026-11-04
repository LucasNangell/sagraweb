import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("shows full-width machine filter with PDF/TIF counts in alphabetical order", () => {
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
    expect(filter).toHaveClass("w-full");
    const machineButtons = within(filter)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label") && !b.getAttribute("aria-label")?.startsWith("Download arquivos"));
    expect(machineButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Espelhos",
      "M1",
      "M2",
    ]);
    const cardOf = (label: string) =>
      within(filter).getByRole("button", { name: label }).parentElement!.parentElement!;
    expect(within(cardOf("Espelhos")).getByText("PDFs baixados: 0 de 1")).toBeInTheDocument();
    expect(within(cardOf("Espelhos")).getByText("TIFFs baixados: 0 de 0")).toBeInTheDocument();
    expect(within(cardOf("M2")).getByText("PDFs baixados: 0 de 0")).toBeInTheDocument();
    expect(within(cardOf("M2")).getByText("TIFFs baixados: 0 de 1")).toBeInTheDocument();
    expect(within(cardOf("M1")).getByText("PDFs baixados: 0 de 0")).toBeInTheDocument();
    expect(within(cardOf("M1")).getByText("TIFFs baixados: 0 de 2")).toBeInTheDocument();
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

  it("shows a half-width machine tab when only one machine has files", () => {
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
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    const tab = within(filter).getByRole("button", { name: "PM52" }).parentElement!
      .parentElement!;
    expect(tab).toHaveClass("w-1/2");
    expect(screen.getByRole("button", { name: /Cad 1/i })).toBeInTheDocument();
  });

  it("keeps PDF and TIF counts visible for each machine button", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      { id: 3, nome: "espelho-pm52.pdf", maquina: "PM52" },
      {
        id: 4,
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
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    const cardOf = (label: string) =>
      within(filter).getByRole("button", { name: label }).parentElement!.parentElement!;
    expect(within(cardOf("PM52")).getByText("PDFs baixados: 0 de 1")).toBeInTheDocument();
    expect(within(cardOf("PM52")).getByText("TIFFs baixados: 0 de 2")).toBeInTheDocument();
    expect(within(cardOf("SM74")).getByText("PDFs baixados: 0 de 0")).toBeInTheDocument();
    expect(within(cardOf("SM74")).getByText("TIFFs baixados: 0 de 1")).toBeInTheDocument();
  });

  it("updates PDF/TIF downloaded counts when files are marked downloaded", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      { id: 3, nome: "espelho-pm52.pdf", maquina: "PM52" },
      {
        id: 4,
        nome: "2026_OS 00612-Gr-Outro (Cad 2 A) (C).tif",
        maquina: "SM74",
      },
    ];
    const downloaded = new Set<number>([1, 3]);
    render(
      <GravacaoExternaArquivosPanel
        ano={2024}
        nrOs={1857}
        arquivos={arquivos}
        selection={null}
        groupByMachine
        downloadedArquivoIds={downloaded}
        onDownloadMachine={() => undefined}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    const cardOf = (label: string) =>
      within(filter).getByRole("button", { name: label }).parentElement!.parentElement!;
    expect(within(cardOf("PM52")).getByText("PDFs baixados: 1 de 1")).toBeInTheDocument();
    expect(within(cardOf("PM52")).getByText("TIFFs baixados: 1 de 2")).toBeInTheDocument();
    expect(within(cardOf("SM74")).getByText("PDFs baixados: 0 de 0")).toBeInTheDocument();
    expect(within(cardOf("SM74")).getByText("TIFFs baixados: 0 de 1")).toBeInTheDocument();
    const pendingBadges = within(filter).getAllByTitle(
      "Baixar arquivos dessa máquina",
    );
    expect(pendingBadges).toHaveLength(2);
    expect(pendingBadges[0]).toHaveClass("bg-amber-100");
  });

  it("requests ZIP download for machine files when Download badge is clicked", () => {
    const onDownloadMachine = vi.fn();
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      { id: 3, nome: "espelho-pm52.pdf", maquina: "PM52" },
      {
        id: 4,
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
        onDownloadMachine={onDownloadMachine}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    fireEvent.click(within(filter).getByRole("button", { name: "Download arquivos PM52" }));
    expect(onDownloadMachine).toHaveBeenCalledTimes(1);
    expect(onDownloadMachine).toHaveBeenCalledWith("PM52", [1, 2, 3]);
  });

  it("turns the machine Download badge green when all files are downloaded", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "PM52" },
      { id: 2, nome: `${GROUP_KEY} (M).tif`, maquina: "PM52" },
      { id: 3, nome: "espelho-pm52.pdf", maquina: "PM52" },
      {
        id: 4,
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
        downloadedArquivoIds={new Set([1, 2, 3, 4])}
        onDownloadMachine={() => undefined}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    expect(
      within(filter).getAllByTitle("Baixar arquivos novamente"),
    ).toHaveLength(2);
    expect(
      within(filter).getAllByTitle("Baixar arquivos novamente")[0],
    ).toHaveClass("bg-emerald-100");
    expect(within(filter).getAllByText("Baixado")).toHaveLength(2);
    expect(within(filter).queryByText("Download")).toBeNull();
  });

  it("keeps the full Download badge text and may shrink the machine name font", () => {
    const arquivos = [
      { id: 1, nome: `${GROUP_KEY} (C).tif`, maquina: "Komori" },
      {
        id: 2,
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
        onDownloadMachine={() => undefined}
        onSelect={() => undefined}
        onSelectComposite={() => undefined}
      />,
    );
    const filter = screen.getByRole("group", { name: /Filtrar arquivos por máquina/i });
    const komoriName = within(filter).getByRole("button", { name: "Komori" });
    const komoriBadge = within(filter).getByRole("button", {
      name: "Download arquivos Komori",
    });
    expect(komoriName).toHaveTextContent("Komori");
    expect(komoriName.className).toContain("whitespace-nowrap");
    expect(komoriBadge).toHaveTextContent("Download");
    expect(komoriBadge.className).toContain("shrink-0");
    expect(komoriBadge.querySelector("span.truncate")).toBeNull();
  });
});
