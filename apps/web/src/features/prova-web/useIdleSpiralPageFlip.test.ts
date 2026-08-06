import { describe, expect, it } from "vitest";

import { idleFlipPadMs } from "./useIdleSpiralPageFlip";

describe("idleFlipPadMs", () => {
  it("completa 1s quando a virada é rápida", () => {
    expect(idleFlipPadMs(650, 1000)).toBe(350);
  });

  it("não espera se já passou o intervalo", () => {
    expect(idleFlipPadMs(1200, 1000)).toBe(0);
  });
});
