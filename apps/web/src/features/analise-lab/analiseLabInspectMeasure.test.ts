import { describe, expect, it } from "vitest";

import {
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
});
