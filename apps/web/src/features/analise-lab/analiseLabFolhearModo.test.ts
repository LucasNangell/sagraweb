import { describe, expect, it } from "vitest";

import {
  defaultFolhearModo,
  normalizeFolhearModo,
} from "./analiseLabFolhearModo";

describe("analiseLabFolhearModo", () => {
  it("default: capa_miolo → flipbook, unico → folhas", () => {
    expect(defaultFolhearModo("capa_miolo")).toBe("flipbook");
    expect(defaultFolhearModo("unico")).toBe("folhas");
    expect(defaultFolhearModo(null)).toBe("folhas");
  });

  it("normalize aceita valores válidos e cai no default", () => {
    expect(normalizeFolhearModo("flipbook", "unico")).toBe("flipbook");
    expect(normalizeFolhearModo("folhas", "capa_miolo")).toBe("folhas");
    expect(normalizeFolhearModo("invalid", "capa_miolo")).toBe("flipbook");
    expect(normalizeFolhearModo(undefined, "unico")).toBe("folhas");
  });
});
