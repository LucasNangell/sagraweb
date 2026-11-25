import { describe, expect, it } from "vitest";

import { intersecaoAreaFrac } from "./papelariaPreviaOtimista";

describe("papelariaPreviaOtimista", () => {
  it("intersecaoAreaFrac detecta sobreposição e área vazia", () => {
    expect(intersecaoAreaFrac([0, 0, 0.5, 0.5], [0.25, 0.25, 0.75, 0.75])).toEqual([
      0.25, 0.25, 0.5, 0.5,
    ]);
    expect(intersecaoAreaFrac([0, 0, 0.2, 0.2], [0.5, 0.5, 0.8, 0.8])).toBeNull();
  });
});
