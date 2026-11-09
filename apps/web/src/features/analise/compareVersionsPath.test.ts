import { describe, expect, it } from "vitest";

import { absoluteToOsRelative, parentDir } from "./compareVersionsPath";

describe("compareVersionsPath", () => {
  it("parentDir remove o último segmento", () => {
    expect(parentDir("\\\\server\\share\\OS\\Original")).toBe(
      "\\\\server\\share\\OS",
    );
    expect(parentDir("C:/os/Original/")).toBe("C:/os");
  });

  it("absoluteToOsRelative normaliza barras e case", () => {
    const root = "\\\\Rede\\Share\\OS123";
    const file = "\\\\rede\\share\\OS123\\Original\\arte.pdf";
    expect(absoluteToOsRelative(file, root)).toBe("Original/arte.pdf");
  });

  it("absoluteToOsRelative rejeita fora da pasta", () => {
    expect(
      absoluteToOsRelative("\\\\a\\b\\other\\x.pdf", "\\\\a\\b\\OS"),
    ).toBeNull();
  });
});
