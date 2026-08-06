import { describe, expect, it } from "vitest";

import { osRelativePathToProofFilename } from "./proofFilePicker";

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
