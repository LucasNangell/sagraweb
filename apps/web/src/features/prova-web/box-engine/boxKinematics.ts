/**
 * Matemática pura da cinemática de caixa (sem WebGL).
 * Coordenadas da cena: X = x_mm - cx, Y = -(y_mm - cy), Z = 0 (folha plana).
 */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type HingeSegmentMm = [[number, number], [number, number]];

export interface NetFrame {
  cx: number;
  cy: number;
}

/** mm da net → coords da cena (origem no centro, Y invertido). */
export function netMmToScene(xMm: number, yMm: number, frame: NetFrame): Vec3 {
  return { x: xMm - frame.cx, y: -(yMm - frame.cy), z: 0 };
}

export function hingeSegmentFromLegacy(h: {
  axis?: string;
  positionMm?: number;
  spanStartMm?: number;
  spanEndMm?: number;
  segmentMm?: number[][] | null;
}): HingeSegmentMm | null {
  const sm = h.segmentMm;
  if (
    Array.isArray(sm) &&
    sm.length >= 2 &&
    Array.isArray(sm[0]) &&
    Array.isArray(sm[1]) &&
    sm[0]!.length >= 2 &&
    sm[1]!.length >= 2
  ) {
    return [
      [Number(sm[0]![0]), Number(sm[0]![1])],
      [Number(sm[1]![0]), Number(sm[1]![1])],
    ];
  }
  const pos = Number(h.positionMm ?? 0);
  const a = Number(h.spanStartMm ?? 0);
  const b = Number(h.spanEndMm ?? 0);
  if (h.axis === "vertical") {
    return [
      [pos, a],
      [pos, b],
    ];
  }
  if (h.axis === "horizontal") {
    return [
      [a, pos],
      [b, pos],
    ];
  }
  if (Number.isFinite(pos) && Number.isFinite(a) && Number.isFinite(b)) {
    return [
      [a, pos],
      [b, pos],
    ];
  }
  return null;
}

export function hingeOriginScene(
  segment: HingeSegmentMm,
  frame: NetFrame,
): Vec3 {
  const mx = (segment[0][0] + segment[1][0]) / 2;
  const my = (segment[0][1] + segment[1][1]) / 2;
  return netMmToScene(mx, my, frame);
}

/** Direção do eixo de dobra na cena (Y invertido). */
export function hingeAxisScene(segment: HingeSegmentMm): Vec3 {
  const dx = segment[1][0] - segment[0][0];
  const dy = -(segment[1][1] - segment[0][1]);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len, z: 0 };
}

/**
 * Posição do pivô do filho no espaço do pai (folha plana) e offset do mesh.
 * Invariante: com rotação zero, vértices em coords da net ficam no lugar certo.
 */
export function childAttachOffsets(
  hingeOrigin: Vec3,
  parentPivotOrigin: Vec3,
): { pivotLocal: Vec3; meshOffset: Vec3 } {
  return {
    pivotLocal: {
      x: hingeOrigin.x - parentPivotOrigin.x,
      y: hingeOrigin.y - parentPivotOrigin.y,
      z: hingeOrigin.z - parentPivotOrigin.z,
    },
    meshOffset: {
      x: -hingeOrigin.x,
      y: -hingeOrigin.y,
      z: -hingeOrigin.z,
    },
  };
}

/** Rotaciona um ponto 3D em torno de um eixo unitário por `angleRad` (Rodrigues). */
export function rotateAroundAxis(
  point: Vec3,
  origin: Vec3,
  axisUnit: Vec3,
  angleRad: number,
): Vec3 {
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const ax = axisUnit.x;
  const ay = axisUnit.y;
  const az = axisUnit.z;
  const dot = ax * px + ay * py + az * pz;
  return {
    x:
      origin.x +
      px * c +
      (ay * pz - az * py) * s +
      ax * dot * (1 - c),
    y:
      origin.y +
      py * c +
      (az * px - ax * pz) * s +
      ay * dot * (1 - c),
    z:
      origin.z +
      pz * c +
      (ax * py - ay * px) * s +
      az * dot * (1 - c),
  };
}

/** UV normalizado da net (u crescente em X, v crescente para cima na textura). */
export function netUv(
  xMm: number,
  yMm: number,
  netW: number,
  netH: number,
  originX = 0,
  originY = 0,
): Vec2 {
  const w = Math.max(1e-6, netW);
  const h = Math.max(1e-6, netH);
  return {
    x: (xMm - originX) / w,
    y: 1 - (yMm - originY) / h,
  };
}

export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
