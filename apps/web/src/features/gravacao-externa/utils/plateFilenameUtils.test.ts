import { describe, expect, it } from "vitest";

import {
  compareNaturalName,
  formatPlatePreviewBadge,
  groupArquivosByCaderno,
  groupArquivosByChapa,
  groupArquivosByMaquina,
  parseCadernoParts,
  parsePlateFilename,
} from "./plateFilenameUtils";

const OS_1857_FILES = [
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (C).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (K).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (M).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (Y).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (C).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (K).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (M).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (Y).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (C).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (K).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (M).tif",
  "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (Y).tif",
];

describe("plateFilenameUtils", () => {
  it("parses color and chapa from OS 1857 filenames", () => {
    const parsed = parsePlateFilename(OS_1857_FILES[2]!);
    expect(parsed.color).toBe("M");
    expect(parsed.chapaLabel).toBe("Cad 1 A");
    expect(parsed.groupKey).toContain("Cad 1 A");
    expect(parsed.groupKey).not.toMatch(/\(M\)/i);
  });

  it("groups 12 files into 3 chapas with 4 colors each", () => {
    const arquivos = OS_1857_FILES.map((nome, index) => ({
      id: index + 1,
      nome,
    }));
    const { chapas, espelhos, others } = groupArquivosByChapa(arquivos);
    expect(chapas).toHaveLength(3);
    expect(espelhos).toHaveLength(0);
    expect(others).toHaveLength(0);
    for (const chapa of chapas) {
      expect(chapa.filesByColor.C).toBeDefined();
      expect(chapa.filesByColor.K).toBeDefined();
      expect(chapa.filesByColor.M).toBeDefined();
      expect(chapa.filesByColor.Y).toBeDefined();
    }
  });

  it("puts PDF files in espelhos and non-plate TIF in others", () => {
    const { chapas, espelhos, others } = groupArquivosByChapa([
      { id: 1, nome: "prova.pdf" },
      { id: 2, nome: "placa.tif" },
    ]);
    expect(chapas).toHaveLength(0);
    expect(espelhos).toHaveLength(1);
    expect(espelhos[0]?.nome).toBe("prova.pdf");
    expect(others).toHaveLength(1);
    expect(others[0]?.nome).toBe("placa.tif");
  });

  it("formats preview badge", () => {
    expect(formatPlatePreviewBadge(OS_1857_FILES[0]!)).toBe("Cad 1 A · C");
    expect(formatPlatePreviewBadge("sem.tif")).toBeNull();
  });

  it("groups Pantone separations into the same caderno as CMYK", () => {
    const base = "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A)";
    const { chapas, others } = groupArquivosByChapa([
      { id: 1, nome: `${base} (C).tif` },
      { id: 2, nome: `${base} (M).tif` },
      { id: 3, nome: `${base} (Pantone 185).tif` },
      { id: 4, nome: `${base} (Spot).tif` },
    ]);
    expect(others).toHaveLength(0);
    expect(chapas).toHaveLength(1);
    expect(chapas[0]?.filesByColor.C).toBeDefined();
    expect(chapas[0]?.filesByColor.M).toBeDefined();
    expect(chapas[0]?.pantoneFiles).toHaveLength(2);
    expect(chapas[0]?.pantoneFiles.map((f) => f.id)).toEqual([3, 4]);
  });

  it("creates a caderno group from Pantone-only files", () => {
    const base = "2026_OS 00612-Gr-Teste (Cad 2 A)";
    const parsed = parsePlateFilename(`${base} (185).tif`);
    expect(parsed.kind).toBe("pantone");
    expect(parsed.color).toBeNull();
    expect(parsed.groupKey).toBe(base);
    expect(formatPlatePreviewBadge(`${base} (185).tif`)).toBe("Cad 2 A · PANTONE");

    const { chapas, others } = groupArquivosByChapa([
      { id: 1, nome: `${base} (185).tif` },
    ]);
    expect(others).toHaveLength(0);
    expect(chapas).toHaveLength(1);
    expect(chapas[0]?.pantoneFiles).toHaveLength(1);
  });

  it("keeps TIF without channel suffix in others", () => {
    const { chapas, others } = groupArquivosByChapa([
      { id: 1, nome: "placa-solta.tif" },
      { id: 2, nome: "arquivo (Cad 1 A).tif" },
    ]);
    expect(chapas).toHaveLength(0);
    expect(others).toHaveLength(2);
  });

  it("groups files by machine with unlabeled last", () => {
    const groups = groupArquivosByMaquina([
      { id: 1, nome: "a.tif", maquina: "M2" },
      { id: 2, nome: "b.tif", maquina: "M1" },
      { id: 3, nome: "c.tif", maquina: "M1" },
      { id: 4, nome: "espelho.pdf", maquina: null },
    ]);
    expect(groups.map((g) => g.maquina)).toEqual(["M1", "M2", ""]);
    expect(groups[0]?.arquivos).toHaveLength(2);
    expect(groups[1]?.arquivos).toHaveLength(1);
    expect(groups[2]?.label).toBe("Sem máquina");
    expect(groups[2]?.arquivos[0]?.nome).toBe("espelho.pdf");
  });

  it("sorts cadernos and filenames in natural ascending order", () => {
    expect(compareNaturalName("file10.tif", "file2.tif")).toBeGreaterThan(0);
    expect(compareNaturalName("Cad 2 A", "Cad 10 A")).toBeLessThan(0);

    const { chapas } = groupArquivosByChapa([
      {
        id: 1,
        nome: "2026_OS 00612-x (Cad 10 A) (C).tif",
      },
      {
        id: 2,
        nome: "2026_OS 00612-x (Cad 2 A) (C).tif",
      },
      {
        id: 3,
        nome: "2026_OS 00612-x (Cad 2 A) (M).tif",
      },
    ]);
    expect(chapas.map((c) => c.displayLabel)).toEqual(["Cad 2 A", "Cad 10 A"]);
  });

  it("parses caderno parts into Frente/Verso", () => {
    expect(parseCadernoParts("Cad 0 A")).toEqual({
      cadernoNumber: 0,
      cadernoKey: "Cad 0",
      face: "A",
      faceLabel: "Frente",
    });
    expect(parseCadernoParts("Cad 1 B")).toMatchObject({
      cadernoKey: "Cad 1",
      face: "B",
      faceLabel: "Verso",
    });
  });

  it("groups Cad A/B faces under a single caderno", () => {
    const arquivos = OS_1857_FILES.map((nome, index) => ({
      id: index + 1,
      nome,
    }));
    const { cadernos, orphanChapas, others } = groupArquivosByCaderno(arquivos);
    expect(others).toHaveLength(0);
    expect(orphanChapas).toHaveLength(0);
    expect(cadernos.map((c) => c.displayLabel)).toEqual(["Cad 1", "Cad 2"]);
    expect(cadernos[0]?.faces.map((f) => f.faceLabel)).toEqual(["Frente"]);
    expect(cadernos[1]?.faces.map((f) => f.faceLabel)).toEqual(["Frente", "Verso"]);
    expect(cadernos[1]?.faces[0]?.filesByColor.C).toBeDefined();
    expect(cadernos[1]?.faces[1]?.filesByColor.C).toBeDefined();
  });
});
