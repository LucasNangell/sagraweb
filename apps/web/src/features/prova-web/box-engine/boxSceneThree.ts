import * as THREE from "three";

import type {
  ProvaWebBoxMockupMeta,
  ProvaWebBoxPanel,
  ProvaWebCaixaOpenOperation,
} from "@/api/provaWeb";

import { addStudioLights, configureRenderer } from "../fold-engine/foldMaterials";
import {
  boxDiagonalMm,
  flapAngleDeg,
  resolveFlapProgress,
} from "./boxTypes";

const U = 1;

export const DEFAULT_ROT_X = 18;
export const DEFAULT_ROT_Y = -38;
export const MAX_ROT_X = 55;
export const ORBIT_SENS_X = 0.35;
export const ORBIT_SENS_Y = 0.45;

export interface BoxSceneHandle {
  setOrbit: (rotXDeg: number, rotYDeg: number) => void;
  setOpen01: (open01: number) => void;
  setZoom: (zoom: number) => void;
  fitView: () => void;
  requestRender: () => void;
  dispose: () => void;
}

type MeshEntry = {
  panel: ProvaWebBoxPanel;
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
  isFlap: boolean;
};

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

function makeFaceMaterial(
  texture: THREE.Texture | null,
  panel: ProvaWebBoxPanel,
  inside = false,
): THREE.Material {
  if (!texture) {
    return new THREE.MeshStandardMaterial({
      color: inside ? 0xf3efe6 : 0xd8dde4,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
  }
  const mat = new THREE.MeshStandardMaterial({
    map: texture.clone(),
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.FrontSide,
  });
  const map = mat.map!;
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  const u0 = panel.u0;
  const v0 = panel.v0;
  const u1 = panel.u1;
  const v1 = panel.v1;
  // Texture offset/repeat for net UV (v inverted: PDF top → Three UV bottom)
  map.repeat.set(u1 - u0, v1 - v0);
  map.offset.set(u0, 1 - v1);
  map.needsUpdate = true;
  if (inside) {
    return new THREE.MeshStandardMaterial({
      color: 0xf7f2e8,
      roughness: 0.9,
      metalness: 0,
      side: THREE.FrontSide,
    });
  }
  return mat;
}

/**
 * Monta caixa tuck-end fechada com abas animáveis.
 * Eixos: X = length, Y = width (altura da face), Z = height (profundidade).
 */
export async function createBoxScene(
  canvas: HTMLCanvasElement,
  boxMockup: ProvaWebBoxMockupMeta,
  artUrl: string,
): Promise<BoxSceneHandle> {
  const L = boxMockup.dimsMm.length * U;
  const W = boxMockup.dimsMm.width * U;
  const H = boxMockup.dimsMm.height * U;
  const thickness = (boxMockup.paperThicknessMm ?? 0.4) * U;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  configureRenderer(renderer, "studio");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = null;

  const root = new THREE.Group();
  scene.add(root);

  const orbit = new THREE.Group();
  root.add(orbit);

  const boxRoot = new THREE.Group();
  orbit.add(boxRoot);

  const diagonal = boxDiagonalMm(boxMockup);
  addStudioLights(scene, diagonal);

  let texture: THREE.Texture | null = null;
  try {
    texture = await loadTexture(artUrl);
  } catch {
    texture = null;
  }

  const byId = new Map<string, MeshEntry>();
  const opsByPanel = new Map<string, ProvaWebCaixaOpenOperation>();
  for (const op of boxMockup.openOperations ?? []) {
    opsByPanel.set(op.panelId, op);
  }

  const panels = boxMockup.panels ?? [];

  function addPanelMesh(
    panel: ProvaWebBoxPanel,
    parent: THREE.Object3D,
    localPos: THREE.Vector3,
    rot: THREE.Euler,
  ): MeshEntry {
    const pivot = new THREE.Object3D();
    pivot.position.copy(localPos);
    pivot.rotation.copy(rot);
    parent.add(pivot);

    const geo = new THREE.BoxGeometry(panel.wMm * U, panel.hMm * U, thickness);
    const frontMat = makeFaceMaterial(texture, panel, false);
    const backMat = makeFaceMaterial(null, panel, true);
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xc5c0b6,
      roughness: 0.9,
    });
    const mats = [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat];
    const mesh = new THREE.Mesh(geo, mats);
    // Center geometry so hinge can sit on an edge: offset later per hinge
    mesh.position.set(panel.wMm * U * 0.5, -panel.hMm * U * 0.5, thickness * 0.5);
    pivot.add(mesh);

    const entry: MeshEntry = {
      panel,
      pivot,
      mesh,
      isFlap: Boolean(panel.flap),
    };
    byId.set(panel.id, entry);
    return entry;
  }

  // Body walls (static closed tube) — front is reference
  const frontPanel = panels.find((p) => p.id === "front");
  const backPanel = panels.find((p) => p.id === "back");
  const rightPanel = panels.find((p) => p.id === "right");
  const leftPanel = panels.find((p) => p.id === "left");
  const gluePanel = panels.find((p) => p.id === "glue");

  const body = new THREE.Group();
  boxRoot.add(body);

  if (frontPanel) {
    // Front at +Z
    addPanelMesh(
      frontPanel,
      body,
      new THREE.Vector3(-L / 2, W / 2, H / 2),
      new THREE.Euler(0, 0, 0),
    );
  }
  if (backPanel) {
    addPanelMesh(
      backPanel,
      body,
      new THREE.Vector3(L / 2, W / 2, -H / 2),
      new THREE.Euler(0, Math.PI, 0),
    );
  }
  if (rightPanel) {
    addPanelMesh(
      rightPanel,
      body,
      new THREE.Vector3(L / 2, W / 2, H / 2),
      new THREE.Euler(0, Math.PI / 2, 0),
    );
  }
  if (leftPanel) {
    addPanelMesh(
      leftPanel,
      body,
      new THREE.Vector3(-L / 2, W / 2, -H / 2),
      new THREE.Euler(0, -Math.PI / 2, 0),
    );
  }
  if (gluePanel) {
    const g = addPanelMesh(
      gluePanel,
      body,
      new THREE.Vector3(-L / 2, W / 2, H / 2),
      new THREE.Euler(0, -Math.PI / 2, 0),
    );
    g.mesh.visible = false;
  }

  function attachFlap(
    panel: ProvaWebBoxPanel | undefined,
    wallId: string,
    hinge: "top" | "bottom",
  ) {
    if (!panel) return;
    const wall = byId.get(wallId);
    if (!wall) return;
    const pivot = new THREE.Object3D();
    // Hinge along top or bottom edge of wall face (local wall coords)
    if (hinge === "top") {
      pivot.position.set(0, 0, 0);
    } else {
      pivot.position.set(0, -W, 0);
    }
    wall.pivot.add(pivot);

    const geo = new THREE.BoxGeometry(panel.wMm * U, panel.hMm * U, thickness);
    const frontMat = makeFaceMaterial(texture, panel, false);
    const backMat = makeFaceMaterial(null, panel, true);
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xc5c0b6,
      roughness: 0.9,
    });
    const mesh = new THREE.Mesh(geo, [
      edgeMat,
      edgeMat,
      edgeMat,
      edgeMat,
      frontMat,
      backMat,
    ]);
    // Place so hinge edge is at pivot: top flap extends +Y in closed? 
    // Closed = folded over opening → rotate toward +Z of world for top of front...
    // Local: flap extends in -Y from top hinge (into wall plane initially for open).
    if (hinge === "top") {
      mesh.position.set(panel.wMm * U * 0.5, panel.hMm * U * 0.5, thickness * 0.5);
    } else {
      mesh.position.set(panel.wMm * U * 0.5, -panel.hMm * U * 0.5, thickness * 0.5);
    }
    pivot.add(mesh);
    byId.set(panel.id, {
      panel,
      pivot,
      mesh,
      isFlap: true,
    });
  }

  attachFlap(
    panels.find((p) => p.id === "dust_front_top"),
    "front",
    "top",
  );
  attachFlap(
    panels.find((p) => p.id === "dust_front_bottom"),
    "front",
    "bottom",
  );
  attachFlap(panels.find((p) => p.id === "tuck_top"), "back", "top");
  attachFlap(panels.find((p) => p.id === "tuck_bottom"), "back", "bottom");
  attachFlap(
    panels.find((p) => p.id === "dust_back_top"),
    "right",
    "top",
  );
  attachFlap(
    panels.find((p) => p.id === "dust_back_bottom"),
    "right",
    "bottom",
  );

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, diagonal * 20);
  let zoom = 1;
  let rotX = DEFAULT_ROT_X;
  let rotY = DEFAULT_ROT_Y;
  let open01 = 0;
  let disposed = false;
  let needsRender = true;

  const fitView = () => {
    const dist = diagonal * 2.2 * zoom;
    camera.position.set(0, 0, dist);
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    needsRender = true;
  };

  const applyOrbit = () => {
    orbit.rotation.order = "YXZ";
    orbit.rotation.y = THREE.MathUtils.degToRad(rotY);
    orbit.rotation.x = THREE.MathUtils.degToRad(rotX);
    needsRender = true;
  };

  const applyOpen = () => {
    const progress = resolveFlapProgress(boxMockup.openOperations ?? [], open01);
    for (const [id, entry] of byId) {
      if (!entry.isFlap) continue;
      const local = progress.get(id) ?? 0;
      const op = opsByPanel.get(id);
      const angle = flapAngleDeg(op, local);
      const hinge = entry.panel.hinge;
      // Closed = 0 relative to folded shut (over the opening = ~90° from wall)
      // open01=0 → flap closed covering opening (rotate ≈ 0 from closed base)
      // open01=1 → flap swings open by `angle` outward
      const closedBase = hinge === "top" ? -Math.PI / 2 : Math.PI / 2;
      const openDelta = THREE.MathUtils.degToRad(angle);
      const sign = hinge === "top" ? 1 : -1;
      entry.pivot.rotation.x = closedBase + sign * openDelta;
    }
    needsRender = true;
  };

  applyOrbit();
  applyOpen();
  fitView();

  const resize = () => {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || canvas.clientWidth || 640;
    const h = parent?.clientHeight || canvas.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    needsRender = true;
  };
  resize();
  const ro = new ResizeObserver(() => resize());
  if (canvas.parentElement) ro.observe(canvas.parentElement);

  let raf = 0;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return {
    setOrbit(rx, ry) {
      rotX = rx;
      rotY = ry;
      applyOrbit();
    },
    setOpen01(v) {
      open01 = Math.max(0, Math.min(1, v));
      applyOpen();
    },
    setZoom(z) {
      zoom = Math.max(0.4, Math.min(3, z));
      fitView();
    },
    fitView,
    requestRender() {
      needsRender = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      texture?.dispose();
      for (const entry of byId.values()) {
        entry.mesh.geometry.dispose();
        const mats = entry.mesh.material;
        if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
        else mats.dispose();
      }
      renderer.dispose();
    },
  };
}
