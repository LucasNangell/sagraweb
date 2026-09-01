/** Folga mínima para a espiral/arco não encostar no recorte do canvas. */
export const SPIRAL_FIT_PADDING = 1.06;

type Vec3 = { x: number; y: number; z: number };

/**
 * Distância de câmera em +Z (olhando a origem) para o AABB caber no frustum
 * sem cortar cantos — o maior enquadramento possível na área.
 */
export function spiralFitDistanceFromCorners(
  corners: ReadonlyArray<Vec3>,
  center: Vec3,
  fovDeg: number,
  aspect: number,
  padding = SPIRAL_FIT_PADDING,
): number {
  const vHalf = (fovDeg * 0.5 * Math.PI) / 180;
  const tanV = Math.tan(vHalf);
  const tanH = tanV * Math.max(0.2, aspect);
  let dist = 0;
  for (const p of corners) {
    const zRel = p.z - center.z;
    dist = Math.max(
      dist,
      Math.abs(p.x - center.x) / tanH + zRel,
      Math.abs(p.y - center.y) / tanV + zRel,
    );
  }
  return Math.max(1, dist) * padding;
}

export function boxCorners(
  min: Vec3,
  max: Vec3,
): Vec3[] {
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z },
  ];
}
