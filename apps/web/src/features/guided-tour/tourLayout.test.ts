import { describe, expect, it } from "vitest";

import { computePopoverPosition } from "./tourLayout";

describe("tourLayout", () => {
  it("centraliza o balão sem alvo", () => {
    const pos = computePopoverPosition(
      null,
      { width: 320, height: 160 },
      "center",
      { width: 1000, height: 800 },
    );
    expect(pos.arrowSide).toBe("none");
    expect(pos.top).toBeGreaterThan(0);
    expect(pos.left).toBeGreaterThan(0);
  });

  it("posiciona abaixo do recorte e mantém na viewport", () => {
    const pos = computePopoverPosition(
      { top: 20, left: 20, width: 100, height: 40 },
      { width: 320, height: 160 },
      "bottom",
      { width: 400, height: 300 },
    );
    expect(pos.arrowSide).toBe("top");
    expect(pos.left + 320).toBeLessThanOrEqual(400);
    expect(pos.top).toBeGreaterThanOrEqual(8);
  });
});
