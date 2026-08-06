import { describe, expect, it } from "vitest";

import { shouldUseVerticalSpiralPager } from "./spiralFlipMode";

describe("shouldUseVerticalSpiralPager", () => {
  it("só com spiralMockup.edge=top", () => {
    expect(shouldUseVerticalSpiralPager(undefined)).toBe(false);
    expect(shouldUseVerticalSpiralPager({})).toBe(false);
    expect(
      shouldUseVerticalSpiralPager({
        spiralMockup: {
          edge: "left",
          holeCount: 10,
          holeDiameterMm: 5,
          marginFromEdgeMm: 8,
          pageWidthMm: 210,
          pageHeightMm: 297,
        },
      }),
    ).toBe(false);
    expect(
      shouldUseVerticalSpiralPager({
        spiralMockup: {
          edge: "top",
          holeCount: 10,
          holeDiameterMm: 5,
          marginFromEdgeMm: 8,
          pageWidthMm: 210,
          pageHeightMm: 297,
        },
      }),
    ).toBe(true);
  });
});
