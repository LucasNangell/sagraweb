import { describe, expect, it } from "vitest";

import {
  childAttachOffsets,
  easeInOutCubic,
  hingeAxisScene,
  hingeOriginScene,
  hingeSegmentFromLegacy,
  netMmToScene,
  netUv,
  rotateAroundAxis,
} from "./boxKinematics";

describe("boxKinematics", () => {
  const frame = { cx: 50, cy: 40 };

  it("netMmToScene centers and flips Y", () => {
    expect(netMmToScene(50, 40, frame)).toEqual({ x: 0, y: -0, z: 0 });
    expect(netMmToScene(60, 30, frame)).toEqual({ x: 10, y: 10, z: 0 });
  });

  it("zero rotation invariant: meshOffset + hingeOrigin cancels", () => {
    const seg = hingeSegmentFromLegacy({
      axis: "vertical",
      positionMm: 50,
      spanStartMm: 0,
      spanEndMm: 80,
    })!;
    const hingeOrigin = hingeOriginScene(seg, frame);
    const parentOrigin = { x: 0, y: 0, z: 0 };
    const { pivotLocal, meshOffset } = childAttachOffsets(
      hingeOrigin,
      parentOrigin,
    );
    expect(pivotLocal).toEqual(hingeOrigin);
    expect(meshOffset.x + hingeOrigin.x).toBeCloseTo(0);
    expect(meshOffset.y + hingeOrigin.y).toBeCloseTo(0);
  });

  it("rotates 90° around diagonal hinge", () => {
    const seg: [[number, number], [number, number]] = [
      [0, 0],
      [100, 100],
    ];
    const origin = hingeOriginScene(seg, { cx: 50, cy: 50 });
    const axis = hingeAxisScene(seg);
    const point = { x: origin.x + 10, y: origin.y, z: 0 };
    const moved = rotateAroundAxis(point, origin, axis, Math.PI / 2);
    // Distância ao eixo preservada
    const dist0 = Math.hypot(point.x - origin.x, point.y - origin.y, point.z);
    const dist1 = Math.hypot(moved.x - origin.x, moved.y - origin.y, moved.z);
    expect(dist1).toBeCloseTo(dist0, 5);
    expect(Math.abs(moved.z)).toBeGreaterThan(5);
  });

  it("derives segment from legacy axis/span", () => {
    const seg = hingeSegmentFromLegacy({
      axis: "horizontal",
      positionMm: 20,
      spanStartMm: 5,
      spanEndMm: 45,
    });
    expect(seg).toEqual([
      [5, 20],
      [45, 20],
    ]);
  });

  it("netUv maps trapezoid vertex into [0,1]", () => {
    const uv = netUv(25, 10, 100, 50, 0, 0);
    expect(uv.x).toBeCloseTo(0.25);
    expect(uv.y).toBeCloseTo(0.8);
  });

  it("easeInOutCubic endpoints", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
});

describe("boxGraphScene duplex materials", () => {
  it("createBoxScene accepts optional artInsideUrl (signature)", async () => {
    const { createBoxScene } = await import("./boxSceneThree");
    expect(createBoxScene.length).toBeGreaterThanOrEqual(3);
  });

  it("assignExtrudeDuplexGroups maps top/side/bottom to materials 0/1/2", async () => {
    const THREE = await import("three");
    const { assignExtrudeDuplexGroups } = await import("./boxGraphScene");
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(10, 0);
    shape.lineTo(10, 8);
    shape.lineTo(0, 8);
    shape.closePath();
    const thickness = 0.4;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
    });
    assignExtrudeDuplexGroups(geo, thickness);
    const mats = new Set(geo.groups.map((g) => g.materialIndex));
    expect(mats.has(0)).toBe(true); // face externa
    expect(mats.has(1)).toBe(true); // kraft
    expect(mats.has(2)).toBe(true); // face interna
    const covered = geo.groups.reduce((n, g) => n + g.count, 0);
    expect(covered).toBe(geo.getAttribute("position").count);
  });
});
