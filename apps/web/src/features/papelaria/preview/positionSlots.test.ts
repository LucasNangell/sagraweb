import { describe, expect, it } from "vitest";

import {
  nearestPreviewPositionSlot,
  slotToElementRect,
} from "./positionSlots";

describe("positionSlots", () => {
  it("resolve slot top-left dentro do canvas", () => {
    const rect = slotToElementRect("top-left", 1200, 800, 400, 48);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.align).toBe("left");
  });

  it("escolhe slot mais próximo do centro", () => {
    const slot = nearestPreviewPositionSlot(600, 400, 1200, 800);
    expect(slot).toBe("center");
  });
});
