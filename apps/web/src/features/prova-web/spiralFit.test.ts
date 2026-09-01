import { describe, expect, it } from "vitest";

import {
  SPIRAL_FIT_PADDING,
  boxCorners,
  spiralFitDistanceFromCorners,
} from "./spiralFit";

describe("spiralFitDistanceFromCorners", () => {
  it("preenche a altura de um retângulo de frente em viewport quadrada", () => {
    const min = { x: -50, y: -100, z: 0 };
    const max = { x: 50, y: 100, z: 0 };
    const center = { x: 0, y: 0, z: 0 };
    const fov = 40;
    const tanV = Math.tan((fov * 0.5 * Math.PI) / 180);
    const dist = spiralFitDistanceFromCorners(
      boxCorners(min, max),
      center,
      fov,
      1,
      1,
    );
    expect(dist).toBeCloseTo(100 / tanV, 5);
  });

  it("em viewport larga o eixo vertical continua limitando", () => {
    const min = { x: -50, y: -100, z: 0 };
    const max = { x: 50, y: 100, z: 0 };
    const center = { x: 0, y: 0, z: 0 };
    const faceOn = spiralFitDistanceFromCorners(
      boxCorners(min, max),
      center,
      40,
      1,
      1,
    );
    const wide = spiralFitDistanceFromCorners(
      boxCorners(min, max),
      center,
      40,
      2,
      1,
    );
    expect(wide).toBeCloseTo(faceOn, 5);
  });

  it("ponto mais perto da câmera exige mais distância (não corta)", () => {
    const flat = spiralFitDistanceFromCorners(
      [{ x: 0, y: 80, z: 0 }],
      { x: 0, y: 0, z: 0 },
      40,
      1,
      1,
    );
    const closer = spiralFitDistanceFromCorners(
      [{ x: 0, y: 80, z: 30 }],
      { x: 0, y: 0, z: 0 },
      40,
      1,
      1,
    );
    expect(closer).toBeGreaterThan(flat);
  });

  it("aplica a folga de padding", () => {
    const min = { x: -10, y: -10, z: 0 };
    const max = { x: 10, y: 10, z: 0 };
    const center = { x: 0, y: 0, z: 0 };
    const raw = spiralFitDistanceFromCorners(
      boxCorners(min, max),
      center,
      40,
      1,
      1,
    );
    const padded = spiralFitDistanceFromCorners(
      boxCorners(min, max),
      center,
      40,
      1,
    );
    expect(padded).toBeCloseTo(raw * SPIRAL_FIT_PADDING, 5);
  });
});
