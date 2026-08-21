import { describe, expect, it } from "vitest";

import { isRelevoSecoCores } from "./ClienteProofPortalExtras";

describe("isRelevoSecoCores", () => {
  it("detecta variantes de relevo seco", () => {
    expect(isRelevoSecoCores("Relev Seco")).toBe(true);
    expect(isRelevoSecoCores("Relevo seco")).toBe(true);
    expect(isRelevoSecoCores("  relev seco  ")).toBe(true);
  });

  it("ignora outras variantes de cores e valores vazios", () => {
    expect(isRelevoSecoCores("Policromia")).toBe(false);
    expect(isRelevoSecoCores("Port/Inglês")).toBe(false);
    expect(isRelevoSecoCores("")).toBe(false);
    expect(isRelevoSecoCores(null)).toBe(false);
    expect(isRelevoSecoCores(undefined)).toBe(false);
  });
});
