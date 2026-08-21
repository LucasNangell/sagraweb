import { describe, expect, it } from "vitest";

import {
  constrainMeasureEndpoint,
  deltaMm,
  distanceMm,
  rectFromPoints,
  rulerFromPoints,
} from "./analiseLabInspectMeasure";

describe("analiseLabInspectMeasure", () => {
  it("builds area rect from two points", () => {
    expect(rectFromPoints({ xMm: 10, yMm: 20 }, { xMm: 40, yMm: 50 })).toEqual({
      xMm: 10,
      yMm: 20,
      wMm: 30,
      hMm: 30,
    });
    expect(rectFromPoints({ xMm: 40, yMm: 50 }, { xMm: 10, yMm: 20 })).toEqual({
      xMm: 10,
      yMm: 20,
      wMm: 30,
      hMm: 30,
    });
  });

  it("computes ruler distance and deltas", () => {
    expect(distanceMm({ xMm: 0, yMm: 0 }, { xMm: 30, yMm: 40 })).toBe(50);
    expect(deltaMm({ xMm: 5, yMm: 5 }, { xMm: 15, yMm: 25 })).toEqual({
      dxMm: 10,
      dyMm: 20,
    });
    expect(rulerFromPoints({ xMm: 1.234, yMm: 2 }, { xMm: 3, yMm: 4.567 })).toEqual(
      {
        x1Mm: 1.23,
        y1Mm: 2,
        x2Mm: 3,
        y2Mm: 4.57,
      },
    );
  });

  it("constrainMeasureEndpoint returns cursor when unconstrained", () => {
    const origin = { xMm: 10, yMm: 20 };
    const cursor = { xMm: 33.3, yMm: 41.7 };
    expect(constrainMeasureEndpoint(origin, cursor, false)).toEqual(cursor);
  });

  it("constrainMeasureEndpoint snaps near-horizontal to dy ≈ 0", () => {
    const origin = { xMm: 0, yMm: 0 };
    const end = constrainMeasureEndpoint(
      origin,
      { xMm: 100, yMm: 8 },
      true,
    );
    expect(Math.abs(end.yMm - origin.yMm)).toBeLessThan(0.01);
    expect(end.xMm).toBeCloseTo(100.32, 1);
  });

  it("constrainMeasureEndpoint snaps near-vertical to dx ≈ 0", () => {
    const origin = { xMm: 0, yMm: 0 };
    const end = constrainMeasureEndpoint(
      origin,
      { xMm: 7, yMm: 80 },
      true,
    );
    expect(Math.abs(end.xMm - origin.xMm)).toBeLessThan(0.01);
    expect(end.yMm).toBeCloseTo(80.31, 1);
  });

  it("constrainMeasureEndpoint snaps near-45° to |dx| ≈ |dy|", () => {
    const origin = { xMm: 0, yMm: 0 };
    const end = constrainMeasureEndpoint(
      origin,
      { xMm: 50, yMm: 42 },
      true,
    );
    expect(Math.abs(Math.abs(end.xMm) - Math.abs(end.yMm))).toBeLessThan(0.02);
  });
});
