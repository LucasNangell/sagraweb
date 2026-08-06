import { describe, expect, it } from "vitest";

/** Espelha a lógica do hook para teste unitário puro. */
function idleUnfoldPercent(elapsedMs: number, halfCycleMs: number): number {
  const half = Math.max(400, halfCycleMs);
  const cycle = (elapsedMs % (half * 2)) / half;
  const goingUp = cycle < 1;
  const local = goingUp ? cycle : 2 - cycle;
  const x = Math.min(1, Math.max(0, local));
  return x * x * (3 - 2 * x) * 100;
}

describe("idleUnfoldPercent", () => {
  const half = 3000;

  it("começa fechado (~0)", () => {
    expect(idleUnfoldPercent(0, half)).toBeCloseTo(0, 5);
  });

  it("no meio do abrir está ~50 (smoothstep)", () => {
    expect(idleUnfoldPercent(half / 2, half)).toBeCloseTo(50, 0);
  });

  it("fim do abrir = 100", () => {
    expect(idleUnfoldPercent(half, half)).toBeCloseTo(100, 5);
  });

  it("fim do ciclo volta a 0", () => {
    expect(idleUnfoldPercent(half * 2, half)).toBeCloseTo(0, 5);
  });
});
