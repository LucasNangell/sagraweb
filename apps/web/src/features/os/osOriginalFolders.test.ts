import { describe, expect, it } from "vitest";

import {
  isOriginalFolderName,
  isOriginalFolderRelative,
  isPreviewableFileName,
  joinOsAbsolutePath,
} from "./osOriginalFolders";

describe("osOriginalFolders", () => {
  it("reconhece pastas Original e o typo Orignal", () => {
    expect(isOriginalFolderName("Original")).toBe(true);
    expect(isOriginalFolderName("Original V2")).toBe(true);
    expect(isOriginalFolderName("orignal")).toBe(true);
    expect(isOriginalFolderName("Sefoc")).toBe(false);
    expect(isOriginalFolderName("AdminDocs")).toBe(false);
  });

  it("exige que o relativo comece numa pasta Original", () => {
    expect(isOriginalFolderRelative("Original/arte.pdf")).toBe(true);
    expect(isOriginalFolderRelative("Original V3/sub/a.pdf")).toBe(true);
    expect(isOriginalFolderRelative("Sefoc/prova.pdf")).toBe(false);
    expect(isOriginalFolderRelative("")).toBe(false);
  });

  it("marca PDF e imagens comuns como preview", () => {
    expect(isPreviewableFileName("a.pdf")).toBe(true);
    expect(isPreviewableFileName("foto.JPG")).toBe(true);
    expect(isPreviewableFileName("layout.ai")).toBe(false);
    expect(isPreviewableFileName("scan.tif")).toBe(false);
  });

  it("monta o caminho UNC para o Folder Opener", () => {
    expect(joinOsAbsolutePath("\\\\rede\\os", "Original/arte.pdf")).toBe(
      "\\\\rede\\os\\Original\\arte.pdf",
    );
  });
});
