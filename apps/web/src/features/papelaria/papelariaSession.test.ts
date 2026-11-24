import { describe, expect, it } from "vitest";

import { validateRequiredFields } from "./components/PapelariaCorelPanel";
import {
  isPapelariaCorelOs,
  isPapelariaProduct,
  isPastaAvulsoProduct,
  isPreImpressoImposicaoProduct,
  isTimbradoA4DigitalProduct,
  isTimbradoA4Product,
  papelariaProofPdfViewerSrc,
  resolveInitialPapelariaTab,
  type PapelariaSessionContext,
} from "./papelariaSession";

describe("resolveInitialPapelariaTab", () => {
  it("abre Corel para OS >= 5000", () => {
    const session: PapelariaSessionContext = {
      osId: "5024",
      osAno: "2025",
      targetProduct: "Ct Visita",
    };
    expect(resolveInitialPapelariaTab(session)).toBe("corel");
    expect(isPapelariaCorelOs("5024")).toBe(true);
  });

  it("mantém SVG sem OS vinculada", () => {
    const session: PapelariaSessionContext = {
      osId: null,
      osAno: null,
      targetProduct: null,
    };
    expect(resolveInitialPapelariaTab(session)).toBe("cartao");
  });

  it("mantém SVG para OS < 5000 se não for produto de papelaria", () => {
    const session: PapelariaSessionContext = {
      osId: "1234",
      osAno: "2025",
      targetProduct: null,
    };
    expect(resolveInitialPapelariaTab(session)).toBe("cartao");
    expect(isPapelariaCorelOs("1234")).toBe(false);
  });

  it("abre Corel para OS < 5000 se o produto for papelaria", () => {
    const session: PapelariaSessionContext = {
      osId: "1234",
      osAno: "2025",
      targetProduct: "Ct Visita",
    };
    expect(resolveInitialPapelariaTab(session)).toBe("corel");
    expect(isPapelariaCorelOs("1234")).toBe(false);
    expect(isPapelariaProduct("Ct Visita")).toBe(true);
    expect(isPapelariaProduct("Folder")).toBe(false);
  });
});

describe("isTimbradoA4DigitalProduct", () => {
  it("reconhece apenas Timbrado A4 (Digital)", () => {
    expect(isTimbradoA4DigitalProduct("Timbrado A4 (Digital)")).toBe(true);
    expect(isTimbradoA4DigitalProduct("timbrado a4 (digital)")).toBe(true);
    expect(isTimbradoA4DigitalProduct("Timbrado A4")).toBe(false);
    expect(isTimbradoA4DigitalProduct("Bloco A5")).toBe(false);
    expect(isTimbradoA4DigitalProduct(null)).toBe(false);
  });
});

describe("isTimbradoA4Product / isPreImpressoImposicaoProduct", () => {
  it("distingue Timbrado offset e produtos pré-impresso", () => {
    expect(isTimbradoA4Product("Timbrado A4")).toBe(true);
    expect(isTimbradoA4Product("Timbrado A4 (Digital)")).toBe(false);
    expect(isPreImpressoImposicaoProduct("Timbrado A4")).toBe(true);
    expect(isPreImpressoImposicaoProduct("Pasta Avulso c/ Bolso")).toBe(true);
    expect(isPreImpressoImposicaoProduct("Ct Visita")).toBe(false);
  });
});

describe("isPastaAvulsoProduct / papelariaProofPdfViewerSrc", () => {
  it("reconhece pastas avulso", () => {
    expect(isPastaAvulsoProduct("Pasta Avulso c/ Bolso")).toBe(true);
    expect(isPastaAvulsoProduct("pasta avulso s/ bolso")).toBe(true);
    expect(isPastaAvulsoProduct("Ct Visita")).toBe(false);
    expect(isPastaAvulsoProduct(null)).toBe(false);
  });

  it("usa FitH para pasta e FitV para os demais", () => {
    expect(
      papelariaProofPdfViewerSrc("/api/email/os/2026/1/proof-file?f=a.pdf", "Pasta Avulso c/ Bolso"),
    ).toBe("/api/email/os/2026/1/proof-file?f=a.pdf#view=FitH&navpanes=0&pagemode=none");
    expect(
      papelariaProofPdfViewerSrc("/api/x.pdf#old", "Ct Visita"),
    ).toBe("/api/x.pdf#view=FitV&navpanes=0&pagemode=none");
  });
});

describe("validateRequiredFields", () => {
  it("exige campos obrigatórios normais", () => {
    const fields = [
      { key: "campo1", label: "Campo 1", required: true, type: "text" },
      { key: "campo2", label: "Campo 2", required: true, type: "text" },
    ];
    const values = { campo1: "Valor 1" };
    expect(validateRequiredFields(fields, values)).toEqual(["Campo 2"]);
  });

  it("ignora campos obrigatórios se estiverem na lista de excluídos", () => {
    const fields = [
      { key: "campo1", label: "Campo 1", required: true, type: "text" },
      { key: "campo2", label: "Campo 2", required: true, type: "text" },
    ];
    const values = { campo1: "Valor 1" };
    expect(validateRequiredFields(fields, values, ["campo2"])).toEqual([]);
  });
});

describe("papelariaProofPdfFit", () => {
  it("orientação do PDF decide: retrato → altura, paisagem → largura", async () => {
    const { papelariaProofPdfFit, papelariaProofPdfViewerSrc } = await import("./papelariaSession");
    expect(papelariaProofPdfFit("Ct Visita", "paisagem")).toBe("FitH");
    expect(papelariaProofPdfFit("Pasta Avulso c/ Bolso", "retrato")).toBe("FitV");
    // Sem orientação lida: regra do produto.
    expect(papelariaProofPdfFit("Pasta Avulso c/ Bolso", null)).toBe("FitH");
    expect(papelariaProofPdfFit("Ct Visita", null)).toBe("FitV");
    expect(papelariaProofPdfViewerSrc("/api/x.pdf#y", "Ct Visita", "paisagem")).toBe(
      "/api/x.pdf#view=FitH&navpanes=0&pagemode=none",
    );
  });
});
