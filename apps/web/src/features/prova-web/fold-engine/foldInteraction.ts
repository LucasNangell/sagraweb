import * as THREE from "three";

export type FoldInteractionState =
  | { type: "idle" }
  | { type: "orbit"; pointerId: number }
  | {
      type: "fold";
      pointerId: number;
      operationId: string;
      initialProgress: number;
      velocity: number;
    }
  | { type: "zoom" };

export const ORBIT_SENS_Y = 0.01;
export const ORBIT_SENS_X = 0.008;
export const MAX_ROT_X = 0.95;
/** Órbita idle inicial: yaw −12° / pitch +12°. */
export const DEFAULT_ROT_Y = (-12 * Math.PI) / 180;
export const DEFAULT_ROT_X = (-18 * Math.PI) / 180;
export const ZOOM_SENS = 0.0015;
/** Sensibilidade do scroll → % de desdobrar (por unidade de deltaY).
 * Com deltaY tipico de mouse (~100) → ~2% por notch. */
export const UNFOLD_WHEEL_SENS = 0.03;

export function pickPanelId(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  meshes: THREE.Object3D[],
): string | null {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshes, true);
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    while (o) {
      const id = o.userData["panelId"];
      if (typeof id === "string") return id;
      o = o.parent;
    }
  }
  return null;
}
