import { describe, expect, it } from "vitest";

import { buildFaceTransform, cropToBackgroundStyle } from "./mockup3dUtils";
import type { MockupFaceConfig } from "./types";

describe("mockup3dUtils", () => {
  it("cropToBackgroundStyle — metade esquerda", () => {
    const s = cropToBackgroundStyle({ x: 0, y: 0, width: 50, height: 100 });
    expect(s.backgroundSize).toBe("200% 100%");
    expect(s.backgroundPosition).toBe("0% 0%");
  });

  it("cropToBackgroundStyle — metade direita", () => {
    const s = cropToBackgroundStyle({ x: 50, y: 0, width: 50, height: 100 });
    expect(s.backgroundSize).toBe("200% 100%");
    expect(s.backgroundPosition).toBe("-100% 0%");
  });

  it("buildFaceTransform — abreComDobra modula rotateY", () => {
    const face: MockupFaceConfig = {
      id: "capa",
      nome: "Capa",
      crop: { x: 0, y: 0, width: 50, height: 100 },
      transform: { rotateY: 30, origin: "right center" },
      abreComDobra: true,
    };
    expect(buildFaceTransform(face, 0)).toBe("rotateY(0deg)");
    expect(buildFaceTransform(face, 0.5)).toBe("rotateY(15deg)");
    expect(buildFaceTransform(face, 1)).toBe("rotateY(30deg)");
  });
});
