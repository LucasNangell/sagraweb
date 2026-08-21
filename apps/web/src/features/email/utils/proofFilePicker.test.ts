import { describe, expect, it } from "vitest";

import {
  extractProvaVersionFromFilename,
  osRelativePathToProofFilename,
  shouldAdoptSuggestedProof,
} from "./proofFilePicker";

describe("osRelativePathToProofFilename", () => {
  it("converte pdf na raiz de Sefoc", () => {
    expect(osRelativePathToProofFilename("Sefoc/prova.pdf")).toBe("prova.pdf");
  });

  it("converte pdf em subpasta de Sefoc", () => {
    expect(osRelativePathToProofFilename("Sefoc/Offset/prova.pdf")).toBe(
      "Offset/prova.pdf",
    );
  });

  it("rejeita fora de Sefoc", () => {
    expect(osRelativePathToProofFilename("Original/prova.pdf")).toBeNull();
  });
});

describe("extractProvaVersionFromFilename", () => {
  it("extrai ProvaSefoc N", () => {
    expect(
      extractProvaVersionFromFilename("6093-26-Nome-ProvaSefoc 4.pdf"),
    ).toBe(4);
  });

  it("extrai legado ProvaN_SEFOC", () => {
    expect(extractProvaVersionFromFilename("05024-Prova2_SEFOC.pdf")).toBe(2);
  });

  it("retorna null sem padrão", () => {
    expect(extractProvaVersionFromFilename("prova_livre.pdf")).toBeNull();
  });
});

describe("shouldAdoptSuggestedProof", () => {
  it("adota suggested vazio → arquivo", () => {
    expect(shouldAdoptSuggestedProof("", "a-ProvaSefoc 4.pdf")).toBe(true);
  });

  it("adota quando suggested tem ProvaSefoc maior", () => {
    expect(
      shouldAdoptSuggestedProof(
        "a-ProvaSefoc 3.pdf",
        "a-ProvaSefoc 4.pdf",
      ),
    ).toBe(true);
  });

  it("não regressa para versão menor", () => {
    expect(
      shouldAdoptSuggestedProof(
        "a-ProvaSefoc 5.pdf",
        "a-ProvaSefoc 4.pdf",
      ),
    ).toBe(false);
  });

  it("não troca quando igual", () => {
    expect(
      shouldAdoptSuggestedProof(
        "a-ProvaSefoc 4.pdf",
        "a-ProvaSefoc 4.pdf",
      ),
    ).toBe(false);
  });

  it("adota suggested com versão quando selecionado não tem padrão", () => {
    expect(
      shouldAdoptSuggestedProof("livre.pdf", "a-ProvaSefoc 2.pdf"),
    ).toBe(true);
  });

  it("não adota suggested sem padrão", () => {
    expect(
      shouldAdoptSuggestedProof("a-ProvaSefoc 3.pdf", "outro.pdf"),
    ).toBe(false);
  });
});
