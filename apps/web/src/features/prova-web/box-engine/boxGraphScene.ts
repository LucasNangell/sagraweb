/**
 * Montagem 3D genérica a partir do grafo net (painéis AABB + hinges).
 * Progresso 0 = dobrado (ângulos-alvo); 1 = aberto (folha plana).
 */
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
import type { BoxSceneHandle } from "./boxSceneThree";

function loadTexture(url: string | null): Promise<THREE.Texture | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function panelMaterial(
  texture: THREE.Texture | null,
  panel: ProvaWebBoxPanel,
): THREE.MeshStandardMaterial {
  if (!texture) {
    return new THREE.MeshStandardMaterial({
      color: 0xd6dde6,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
  }
  const mat = new THREE.MeshStandardMaterial({
    map: texture.clone(),
    roughness: 0.7,
    side: THREE.DoubleSide,
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

export async function createGraphBoxScene(
  canvas: HTMLCanvasElement,
  boxMockup: ProvaWebBoxMockupMeta,
  artUrl: string | null,
): Promise<BoxSceneHandle> {
  const thickness = (boxMockup.paperThicknessMm ?? 0.4) * 1;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  configureRenderer(renderer, "studio");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const orbit = new THREE.Group();
  root.add(orbit);
  const netRoot = new THREE.Group();
  orbit.add(netRoot);

  const diagonal = Math.max(
    40,
    boxDiagonalMm({
      ...boxMockup,
      dimsMm: {
        length: boxMockup.netWidthMm || boxMockup.dimsMm.length,
        width: boxMockup.netHeightMm || boxMockup.dimsMm.width,
        height: boxMockup.dimsMm.height,
      },
    }),
  );
  addStudioLights(scene, diagonal);

  const texture = await loadTexture(artUrl);
  const panels = (boxMockup.panels ?? []).filter((p) => p.wMm > 0 && p.hMm > 0);
  const baseId =
    (boxMockup as { basePanelId?: string }).basePanelId ||
    panels.find((p) => !p.flap)?.id ||
    panels[0]?.id;

  type Entry = {
    panel: ProvaWebBoxPanel;
    pivot: THREE.Object3D;
    mesh: THREE.Mesh;
  };
  const byId = new Map<string, Entry>();

  // Centro da net para enquadrar
  const netW = boxMockup.netWidthMm || 100;
  const netH = boxMockup.netHeightMm || 100;
  const cx = netW / 2;
  const cy = netH / 2;

  for (const panel of panels) {
    const pivot = new THREE.Object3D();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(panel.wMm, panel.hMm, thickness),
      panelMaterial(texture, panel),
    );
    // Pivot no canto superior-esquerdo do painel (espaço net)
    mesh.position.set(panel.wMm / 2, -panel.hMm / 2, thickness / 2);
    pivot.add(mesh);
    byId.set(panel.id, { panel, pivot, mesh });
  }

  // Árvore: base no netRoot; filhos anexados pelo parentId na aresta comum
  const hinges = (
    boxMockup as {
      hinges?: Array<{
        id: string;
        panelA: string;
        panelB: string;
        axis: string;
        positionMm: number;
      }>;
    }
  ).hinges;

  function attachChild(childId: string, parentId: string) {
    const child = byId.get(childId);
    const parent = byId.get(parentId);
    if (!child || !parent) return;
    const hinge = (hinges ?? []).find(
      (h) =>
        (h.panelA === childId && h.panelB === parentId) ||
        (h.panelB === childId && h.panelA === parentId),
    );
    // Posição do pivô filho no espaço do pai = offset net parent→child hinge
    const pc = child.panel;
    const pp = parent.panel;
    let localX = pc.xMm - pp.xMm;
    let localY = -(pc.yMm - pp.yMm);
    if (hinge?.axis === "vertical") {
      // Hinge na vertical entre panels: pivô na borda compartilhada relativo ao pai
      const sharedX = hinge.positionMm - pp.xMm;
      localX = sharedX;
      localY = -(pc.yMm - pp.yMm);
      child.mesh.position.set(pc.xMm - hinge.positionMm + pc.wMm / 2, -pc.hMm / 2, thickness / 2);
    } else if (hinge?.axis === "horizontal") {
      const sharedY = hinge.positionMm - pp.yMm;
      localX = pc.xMm - pp.xMm;
      localY = -sharedY;
      child.mesh.position.set(pc.wMm / 2, -(pc.yMm - hinge.positionMm + pc.hMm / 2), thickness / 2);
    }
    child.pivot.position.set(localX, localY, 0);
    parent.pivot.add(child.pivot);
  }

  const attached = new Set<string>();
  if (baseId && byId.has(baseId)) {
    const base = byId.get(baseId)!;
    base.pivot.position.set(base.panel.xMm - cx, -(base.panel.yMm - cy), 0);
    netRoot.add(base.pivot);
    attached.add(baseId);
    // BFS attach
    const queue = [baseId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of panels) {
        if (attached.has(p.id)) continue;
        if (p.parentId === cur) {
          attachChild(p.id, cur);
          attached.add(p.id);
          queue.push(p.id);
        }
      }
      // Também por hinges se parentId ainda não setado
      for (const h of hinges ?? []) {
        const other =
          h.panelA === cur ? h.panelB : h.panelB === cur ? h.panelA : null;
        if (!other || attached.has(other)) continue;
        const childPanel = byId.get(other)?.panel;
        if (childPanel && !childPanel.parentId) {
          childPanel.parentId = cur;
        }
        if (childPanel?.parentId === cur || !childPanel?.parentId) {
          if (!attached.has(other)) {
            if (byId.get(other)?.panel) {
              byId.get(other)!.panel.parentId = cur;
            }
            attachChild(other, cur);
            attached.add(other);
            queue.push(other);
          }
        }
      }
    }
  }

  // Orphans flat
  for (const [id, entry] of byId) {
    if (attached.has(id)) continue;
    entry.pivot.position.set(
      entry.panel.xMm - cx,
      -(entry.panel.yMm - cy),
      0,
    );
    netRoot.add(entry.pivot);
  }

  const opsByPanel = new Map<string, ProvaWebCaixaOpenOperation>();
  for (const op of boxMockup.openOperations ?? []) {
    if (op.panelId) opsByPanel.set(op.panelId, op);
  }

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, diagonal * 40);
  let zoom = 1;
  let rotX = 25;
  let rotY = -35;
  let open01 = 0;
  let disposed = false;
  let needsRender = true;

  const fitView = () => {
    const dist = diagonal * 1.8 * zoom;
    camera.position.set(0, 0, dist);
    camera.near = Math.max(0.1, dist / 200);
    camera.far = dist * 40;
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
    // 0 = fechado (ângulo alvo); 1 = aberto (0°)
    const progress = resolveFlapProgress(boxMockup.openOperations ?? [], open01);
    for (const [id, entry] of byId) {
      if (id === baseId) {
        entry.pivot.rotation.set(0, 0, 0);
        continue;
      }
      const local = progress.get(id) ?? 0;
      const op = opsByPanel.get(id);
      const target = flapAngleDeg(op, 1); // full target
      const angle = target * (1 - local); // open → flatten
      const hinge = (hinges ?? []).find(
        (h) =>
          (h.panelA === id && h.panelB === entry.panel.parentId) ||
          (h.panelB === id && h.panelA === entry.panel.parentId),
      );
      if (hinge?.axis === "vertical") {
        entry.pivot.rotation.set(0, THREE.MathUtils.degToRad(angle), 0);
      } else {
        entry.pivot.rotation.set(THREE.MathUtils.degToRad(-angle), 0, 0);
      }
    }
    needsRender = true;
  };

  applyOrbit();
  applyOpen();
  fitView();

  const resize = () => {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || 640;
    const h = parent?.clientHeight || 400;
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
      for (const e of byId.values()) {
        e.mesh.geometry.dispose();
        const m = e.mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
      renderer.dispose();
    },
  };
}
