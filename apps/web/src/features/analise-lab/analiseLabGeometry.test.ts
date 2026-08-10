import { describe, expect, it } from "vitest";

import {
  clamp,
  distanceMm,
  formatMm,
  mmPerPx,
  pageSizeMm,
  ptToMm,
  pxPerMm,
} from "./analiseLabGeometry";

describe("analiseLabGeometry", () => {
  it("converts pt to mm", () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 5);
  });

  it("derives page size in mm", () => {
    const size = pageSizeMm(210 * (72 / 25.4), 297 * (72 / 25.4));
    expect(size.widthMm).toBeCloseTo(210, 1);
    expect(size.heightMm).toBeCloseTo(297, 1);
  });

  it("computes pxPerMm and mmPerPx consistently", () => {
    const ratio = pxPerMm(420, 210);
    expect(ratio).toBeCloseTo(2, 5);
    expect(mmPerPx(420, 210)).toBeCloseTo(0.5, 5);
  });

  it("computes distance and clamps", () => {
    expect(distanceMm(0, 0, 3, 4)).toBeCloseTo(5, 5);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(formatMm(7.25)).toBe("7.3 mm");
  });
});
