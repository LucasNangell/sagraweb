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

export const DEFAULT_ROT_X = 22;
export const DEFAULT_ROT_Y = -42;
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
  kind: "body" | "lid" | "dust" | "collar" | "bottom";
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
  if (inside || !texture) {
    return new THREE.MeshStandardMaterial({
      color: inside ? 0xf7f2e8 : 0xd8dde4,
      roughness: inside ? 0.9 : 0.85,
      metalness: 0.02,
      side: THREE.FrontSide,
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
  map.repeat.set(panel.u1 - panel.u0, panel.v1 - panel.v0);
  map.offset.set(panel.u0, 1 - panel.v1);
  map.needsUpdate = true;
  return mat;
}

function makePanelMesh(
  panel: ProvaWebBoxPanel,
  texture: THREE.Texture | null,
  thickness: number,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(panel.wMm * U, panel.hMm * U, thickness);
  const frontMat = makeFaceMaterial(texture, panel, false);
  const backMat = makeFaceMaterial(null, panel, true);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xc5c0b6,
    roughness: 0.9,
  });
  return new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]);
}

export async function createBoxScene(
  canvas: HTMLCanvasElement,
  boxMockup: ProvaWebBoxMockupMeta,
  artUrl: string | null,
): Promise<BoxSceneHandle> {
  if (boxMockup.template === "graph" || (boxMockup as { source?: string }).source === "box_model") {
    const { createGraphBoxScene } = await import("./boxGraphScene");
    return createGraphBoxScene(canvas, boxMockup, artUrl);
  }
  return createFlipTopBoxScene(canvas, boxMockup, artUrl ?? "");
}

/** @deprecated nome interno — use createBoxScene */
async function createFlipTopBoxScene(
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
  const find = (id: string) => panels.find((p) => p.id === id);

  const body = new THREE.Group();
  boxRoot.add(body);

  function addBodyWall(
    panel: ProvaWebBoxPanel | undefined,
    pos: THREE.Vector3,
    rotY: number,
    visible = true,
  ) {
    if (!panel) return;
    const pivot = new THREE.Object3D();
    pivot.position.copy(pos);
    pivot.rotation.y = rotY;
    body.add(pivot);
    const mesh = makePanelMesh(panel, texture, thickness);
    // Origem no canto superior-esquerdo da face, normal +Z local
    mesh.position.set(panel.wMm * U * 0.5, -panel.hMm * U * 0.5, thickness * 0.5);
    pivot.add(mesh);
    mesh.visible = visible;
    byId.set(panel.id, { panel, pivot, mesh, kind: "body" });
  }

  // Faces do tubo (fechado)
  addBodyWall(find("front"), new THREE.Vector3(-L / 2, W / 2, H / 2), 0);
  addBodyWall(find("back"), new THREE.Vector3(L / 2, W / 2, -H / 2), Math.PI);
  addBodyWall(find("right"), new THREE.Vector3(L / 2, W / 2, H / 2), Math.PI / 2);
  addBodyWall(find("left"), new THREE.Vector3(-L / 2, W / 2, -H / 2), -Math.PI / 2);
  addBodyWall(find("glue"), new THREE.Vector3(-L / 2, W / 2, H / 2), -Math.PI / 2, false);

  // —— Tampa flip-top: pivô na aresta superior do painel traseiro ——
  const lidTopPanel = find("lid_top");
  const lidFrontPanel = find("lid_front");
  const lidPivot = new THREE.Object3D();
  // Areia superior-traseira do volume
  lidPivot.position.set(0, W / 2, -H / 2);
  boxRoot.add(lidPivot);

  if (lidTopPanel) {
    const mesh = makePanelMesh(lidTopPanel, texture, thickness);
    // Em espaço do pivô (antes de dobrar): painel sobe em +Y (continuação do verso)
    mesh.position.set(0, lidTopPanel.hMm * U * 0.5, thickness * 0.5);
    lidPivot.add(mesh);
    byId.set(lidTopPanel.id, {
      panel: lidTopPanel,
      pivot: lidPivot,
      mesh,
      kind: "lid",
    });
  }

  if (lidFrontPanel && lidTopPanel) {
    const frontPivot = new THREE.Object3D();
    // Extremidade distal do lid_top
    frontPivot.position.set(0, lidTopPanel.hMm * U, 0);
    // Canto de 90° da tampa (fixo em relação ao lid_top)
    frontPivot.rotation.x = Math.PI / 2;
    lidPivot.add(frontPivot);
    const mesh = makePanelMesh(lidFrontPanel, texture, thickness);
    mesh.position.set(0, lidFrontPanel.hMm * U * 0.5, thickness * 0.5);
    frontPivot.add(mesh);
    byId.set(lidFrontPanel.id, {
      panel: lidFrontPanel,
      pivot: frontPivot,
      mesh,
      kind: "lid",
    });
  }

  // Dust laterais (dobram para dentro do vão superior)
  function attachSideDust(
    panel: ProvaWebBoxPanel | undefined,
    wallId: string,
  ) {
    if (!panel) return;
    const wall = byId.get(wallId);
    if (!wall) return;
    const pivot = new THREE.Object3D();
    // Topo da parede lateral
    pivot.position.set(0, 0, 0);
    wall.pivot.add(pivot);
    const mesh = makePanelMesh(panel, texture, thickness);
    mesh.position.set(panel.wMm * U * 0.5, panel.hMm * U * 0.5, thickness * 0.5);
    pivot.add(mesh);
    byId.set(panel.id, { panel, pivot, mesh, kind: "dust" });
  }

  attachSideDust(find("dust_right_top"), "right");
  attachSideDust(find("dust_left_top"), "left");

  // Gola frontal (permanece quase fechada; abre pouco no final)
  const collarPanel = find("front_collar");
  if (collarPanel) {
    const front = byId.get("front");
    if (front) {
      const pivot = new THREE.Object3D();
      pivot.position.set(0, 0, 0);
      front.pivot.add(pivot);
      const mesh = makePanelMesh(collarPanel, texture, thickness);
      mesh.position.set(
        collarPanel.wMm * U * 0.5,
        collarPanel.hMm * U * 0.5,
        thickness * 0.5,
      );
      pivot.add(mesh);
      byId.set(collarPanel.id, {
        panel: collarPanel,
        pivot,
        mesh,
        kind: "collar",
      });
    }
  }

  // Fundo fechado (estático)
  function attachBottom(
    panel: ProvaWebBoxPanel | undefined,
    wallId: string,
  ) {
    if (!panel) return;
    const wall = byId.get(wallId);
    if (!wall) return;
    const pivot = new THREE.Object3D();
    pivot.position.set(0, -W, 0);
    // Fechado cobrindo a base
    pivot.rotation.x = Math.PI / 2;
    wall.pivot.add(pivot);
    const mesh = makePanelMesh(panel, texture, thickness);
    mesh.position.set(panel.wMm * U * 0.5, -panel.hMm * U * 0.5, thickness * 0.5);
    pivot.add(mesh);
    byId.set(panel.id, { panel, pivot, mesh, kind: "bottom" });
  }
  attachBottom(find("bottom_back"), "back");
  attachBottom(find("bottom_front"), "front");

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, diagonal * 20);
  let zoom = 1;
  let rotX = DEFAULT_ROT_X;
  let rotY = DEFAULT_ROT_Y;
  let open01 = 0;
  let disposed = false;
  let needsRender = true;

  const fitView = () => {
    const dist = diagonal * 2.35 * zoom;
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

    // Tampa: fechada = −90° (cobre o topo); abre girando para trás
    const lidLocal = progress.get("lid_top") ?? 0;
    const lidOp = opsByPanel.get("lid_top");
    const lidAngle = flapAngleDeg(lidOp, lidLocal);
    lidPivot.rotation.x =
      -Math.PI / 2 + THREE.MathUtils.degToRad(lidAngle);

    // Dust: fechados cobrindo o vão (−90°); abrem para o plano da parede
    for (const id of ["dust_right_top", "dust_left_top"] as const) {
      const entry = byId.get(id);
      if (!entry) continue;
      const local = progress.get(id) ?? 0;
      const op = opsByPanel.get(id);
      const angle = flapAngleDeg(op, local);
      entry.pivot.rotation.x =
        -Math.PI / 2 + THREE.MathUtils.degToRad(angle);
    }

    // Gola: quase vertical fechada; abre um pouco para fora
    const collar = byId.get("front_collar");
    if (collar) {
      const local = progress.get("front_collar") ?? 0;
      const op = opsByPanel.get("front_collar");
      const angle = flapAngleDeg(op, local);
      collar.pivot.rotation.x = -THREE.MathUtils.degToRad(angle);
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
