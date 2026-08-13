import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type {
  ProvaWebBoxMockupMeta,
  ProvaWebBoxPanel,
  ProvaWebCaixaOpenOperation,
} from "@/api/provaWeb";

import {
  childAttachOffsets,
  hingeAxisScene,
  hingeOriginScene,
  hingeSegmentFromLegacy,
  netMmToScene,
  type HingeSegmentMm,
  type NetFrame,
  type Vec3,
} from "./boxKinematics";
import { boxDiagonalMm, flapAngleDeg, resolveFlapProgress } from "./boxTypes";
import type { BoxSceneHandle } from "./boxSceneThree";
import { tweenValue, type TweenHandle } from "./boxTween";
import {
  addStudioLights,
  configureRenderer,
} from "../fold-engine/foldMaterials";

type GraphHinge = {
  id: string;
  panelA: string;
  panelB: string;
  axis: string;
  positionMm: number;
  spanStartMm?: number;
  spanEndMm?: number;
  segmentMm?: number[][];
};

function loadTexture(url: string | null): Promise<THREE.Texture | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
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

function makeFaceMaterial(
  texture: THREE.Texture | null,
  depth: number,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0xd6dde6,
    map: texture ?? null,
    roughness: 0.72,
    metalness: 0.02,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xf5f0e6),
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -Math.max(1, depth),
    polygonOffsetUnits: -Math.max(1, depth),
  });
  if (mat.map) {
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.wrapS = THREE.ClampToEdgeWrapping;
    mat.map.wrapT = THREE.ClampToEdgeWrapping;
  }
  return mat;
}

function makeKraftMaterial(depth: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc4a574,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -Math.max(1, depth),
    polygonOffsetUnits: -Math.max(1, depth),
  });
}

function makeNetUvGenerator(
  frame: NetFrame,
  netW: number,
  netH: number,
  cutX0: number,
  cutY0: number,
) {
  return {
    generateTopUV(
      _geometry: THREE.ExtrudeGeometry,
      vertices: number[],
      indexA: number,
      indexB: number,
      indexC: number,
    ): THREE.Vector2[] {
      const toUv = (i: number) => {
        const sx = vertices[i * 3]!;
        const sy = vertices[i * 3 + 1]!;
        const xMm = sx + frame.cx;
        const yMm = -sy + frame.cy;
        return new THREE.Vector2(
          (xMm - cutX0) / Math.max(1e-6, netW),
          1 - (yMm - cutY0) / Math.max(1e-6, netH),
        );
      };
      return [toUv(indexA), toUv(indexB), toUv(indexC)];
    },
    generateSideWallUV(
      _geometry: THREE.ExtrudeGeometry,
      vertices: number[],
      indexA: number,
      indexB: number,
      indexC: number,
      indexD: number,
    ): THREE.Vector2[] {
      const a = new THREE.Vector2(0, 0);
      const b = new THREE.Vector2(1, 0);
      const c = new THREE.Vector2(1, 1);
      const d = new THREE.Vector2(0, 1);
      void vertices;
      void indexA;
      void indexB;
      void indexC;
      void indexD;
      return [a, b, c, d];
    },
  };
}

function panelGeometry(
  panel: ProvaWebBoxPanel,
  thickness: number,
  frame: NetFrame,
  netW: number,
  netH: number,
  cutX0: number,
  cutY0: number,
): THREE.BufferGeometry {
  const poly = panel.polygonMm;
  const uvgen = makeNetUvGenerator(frame, netW, netH, cutX0, cutY0);
  if (poly && poly.length >= 3) {
    const shape = new THREE.Shape();
    const first = poly[0]!;
    const s0 = netMmToScene(first[0]!, first[1]!, frame);
    shape.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length; i++) {
      const pt = poly[i]!;
      const s = netMmToScene(pt[0]!, pt[1]!, frame);
      shape.lineTo(s.x, s.y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      UVGenerator: uvgen,
    });
  }
  // Fallback AABB → retângulo em coords da net
  const shape = new THREE.Shape();
  const corners: Array<[number, number]> = [
    [panel.xMm, panel.yMm],
    [panel.xMm + panel.wMm, panel.yMm],
    [panel.xMm + panel.wMm, panel.yMm + panel.hMm],
    [panel.xMm, panel.yMm + panel.hMm],
  ];
  const s0 = netMmToScene(corners[0]![0], corners[0]![1], frame);
  shape.moveTo(s0.x, s0.y);
  for (let i = 1; i < corners.length; i++) {
    const s = netMmToScene(corners[i]![0], corners[i]![1], frame);
    shape.lineTo(s.x, s.y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    UVGenerator: uvgen,
  });
}

function resolveHingeSegment(h: GraphHinge | undefined): HingeSegmentMm | null {
  if (!h) return null;
  return hingeSegmentFromLegacy(h);
}

export async function createGraphBoxScene(
  canvas: HTMLCanvasElement,
  boxMockup: ProvaWebBoxMockupMeta,
  artUrl: string | null,
): Promise<BoxSceneHandle> {
  const thickness = Math.max(0.15, boxMockup.paperThicknessMm ?? 0.4);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  configureRenderer(renderer, "studio");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

  // Luz de sombra dedicada
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(diagonal * 0.6, diagonal * 0.9, diagonal * 0.7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = diagonal * 6;
  const extent = diagonal * 1.2;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(diagonal * 4, diagonal * 4),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -diagonal * 0.35;
  ground.receiveShadow = true;
  scene.add(ground);

  const texture = await loadTexture(artUrl);
  const panels = (boxMockup.panels ?? []).filter((p) => p.wMm > 0 && p.hMm > 0);
  const baseId =
    boxMockup.basePanelId ||
    panels.find((p) => !p.flap)?.id ||
    panels[0]?.id;

  const netW = boxMockup.netWidthMm || 100;
  const netH = boxMockup.netHeightMm || 100;
  const cut = boxMockup.cutBboxMm ?? {};
  const cutX0 = Number(cut.x0Mm ?? 0);
  const cutY0 = Number(cut.y0Mm ?? 0);
  const frame: NetFrame = { cx: netW / 2 + cutX0, cy: netH / 2 + cutY0 };
  // Prefer cut bbox center when available
  if (cut.x0Mm != null && cut.x1Mm != null) {
    frame.cx = (Number(cut.x0Mm) + Number(cut.x1Mm)) / 2;
  } else {
    frame.cx = cutX0 + netW / 2;
  }
  if (cut.y0Mm != null && cut.y1Mm != null) {
    frame.cy = (Number(cut.y0Mm) + Number(cut.y1Mm)) / 2;
  } else {
    frame.cy = cutY0 + netH / 2;
  }

  type Entry = {
    panel: ProvaWebBoxPanel;
    pivot: THREE.Object3D;
    mesh: THREE.Mesh;
    pivotOrigin: Vec3;
  };
  const byId = new Map<string, Entry>();

  const faceMat = makeFaceMaterial(texture, 1);
  const kraftMat = makeKraftMaterial(1);
  const materials = [faceMat, kraftMat, faceMat];

  for (const panel of panels) {
    const pivot = new THREE.Object3D();
    const geo = panelGeometry(
      panel,
      thickness,
      frame,
      netW,
      netH,
      cutX0,
      cutY0,
    );
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(0, 0, 0);
    pivot.add(mesh);
    byId.set(panel.id, {
      panel,
      pivot,
      mesh,
      pivotOrigin: { x: 0, y: 0, z: 0 },
    });
  }

  const hinges = (boxMockup.hinges ?? []) as GraphHinge[];

  const adj = new Map<string, string[]>();
  for (const h of hinges) {
    if (!h.panelA || !h.panelB || h.panelA === h.panelB) continue;
    const a = adj.get(h.panelA) ?? [];
    const b = adj.get(h.panelB) ?? [];
    if (!a.includes(h.panelB)) a.push(h.panelB);
    if (!b.includes(h.panelA)) b.push(h.panelA);
    adj.set(h.panelA, a);
    adj.set(h.panelB, b);
  }

  const hingeAxisByChild = new Map<string, Vec3>();

  function findHinge(childId: string, parentId: string): GraphHinge | undefined {
    return hinges.find(
      (h) =>
        (h.panelA === childId && h.panelB === parentId) ||
        (h.panelB === childId && h.panelA === parentId),
    );
  }

  function attachChild(childId: string, parentId: string) {
    const child = byId.get(childId);
    const parent = byId.get(parentId);
    if (!child || !parent) return;
    child.panel.parentId = parentId;
    const hinge = findHinge(childId, parentId);
    const segment = resolveHingeSegment(hinge);
    if (!segment) {
      // Sem segmento: encaixa no mesmo frame do pai
      child.pivot.position.set(0, 0, 0);
      child.mesh.position.set(0, 0, 0);
      child.pivotOrigin = { ...parent.pivotOrigin };
      parent.pivot.add(child.pivot);
      return;
    }
    const hingeOrigin = hingeOriginScene(segment, frame);
    const axis = hingeAxisScene(segment);
    hingeAxisByChild.set(childId, axis);
    const { pivotLocal, meshOffset } = childAttachOffsets(
      hingeOrigin,
      parent.pivotOrigin,
    );
    child.pivot.position.set(pivotLocal.x, pivotLocal.y, pivotLocal.z);
    child.mesh.position.set(meshOffset.x, meshOffset.y, meshOffset.z);
    child.pivotOrigin = hingeOrigin;
    parent.pivot.add(child.pivot);
  }

  const attached = new Set<string>();
  if (baseId && byId.has(baseId)) {
    const base = byId.get(baseId)!;
    base.panel.parentId = null;
    base.pivot.position.set(0, 0, 0);
    base.mesh.position.set(0, 0, 0);
    base.pivotOrigin = { x: 0, y: 0, z: 0 };
    netRoot.add(base.pivot);
    attached.add(baseId);
    const queue = [baseId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (attached.has(nb)) continue;
        attachChild(nb, cur);
        attached.add(nb);
        queue.push(nb);
      }
    }
  }

  // Orphans flat
  for (const [id, entry] of byId) {
    if (attached.has(id)) continue;
    entry.pivot.position.set(0, 0, 0);
    entry.mesh.position.set(0, 0, 0);
    netRoot.add(entry.pivot);
  }

  // Vincos visíveis (arestas de dobra)
  const creasePositions: number[] = [];
  for (const h of hinges) {
    const seg = resolveHingeSegment(h);
    if (!seg) continue;
    const a = netMmToScene(seg[0][0], seg[0][1], frame);
    const b = netMmToScene(seg[1][0], seg[1][1], frame);
    creasePositions.push(a.x, a.y, thickness + 0.02, b.x, b.y, thickness + 0.02);
  }
  let creaseLines: THREE.LineSegments | null = null;
  if (creasePositions.length >= 6) {
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(creasePositions, 3),
    );
    creaseLines = new THREE.LineSegments(
      cGeo,
      new THREE.LineBasicMaterial({
        color: 0x2a6f7a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    netRoot.add(creaseLines);
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
  let openTween: TweenHandle | null = null;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false; // zoom/open ficam nos controles da UI
  controls.minPolarAngle = THREE.MathUtils.degToRad(5);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(175);
  controls.addEventListener("change", () => {
    needsRender = true;
  });

  const fitView = () => {
    const dist = diagonal * 1.8 * zoom;
    camera.position.set(
      dist * 0.15,
      dist * 0.35,
      dist,
    );
    camera.near = Math.max(0.1, dist / 200);
    camera.far = dist * 40;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    needsRender = true;
  };

  const applyOrbit = () => {
    // Mantém API setOrbit: converte pitch/yaw em posição esférica
    const dist = camera.position.length() || diagonal * 1.8 * zoom;
    const phi = THREE.MathUtils.degToRad(90 - rotX);
    const theta = THREE.MathUtils.degToRad(rotY);
    camera.position.set(
      dist * Math.sin(phi) * Math.sin(theta),
      dist * Math.cos(phi),
      dist * Math.sin(phi) * Math.cos(theta),
    );
    controls.target.set(0, 0, 0);
    controls.update();
    needsRender = true;
  };

  const applyOpen = () => {
    const close01 = 1 - open01;
    const progress = resolveFlapProgress(
      boxMockup.openOperations ?? [],
      close01,
    );
    for (const [id, entry] of byId) {
      if (id === baseId) {
        entry.pivot.quaternion.identity();
        continue;
      }
      const op = opsByPanel.get(id);
      if (!op) {
        entry.pivot.quaternion.identity();
        continue;
      }
      const local = progress.get(id) ?? 0;
      const target = flapAngleDeg(op, 1);
      const angle = THREE.MathUtils.degToRad(target * local);
      const axis = hingeAxisByChild.get(id) ?? { x: 0, y: 1, z: 0 };
      entry.pivot.quaternion.setFromAxisAngle(
        new THREE.Vector3(axis.x, axis.y, axis.z),
        angle,
      );
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
    const damping = controls.update();
    if (damping) needsRender = true;
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
      const target = Math.max(0, Math.min(1, v));
      openTween?.cancel();
      const from = open01;
      if (Math.abs(target - from) < 0.001) {
        open01 = target;
        applyOpen();
        return;
      }
      openTween = tweenValue(from, target, 280, (val) => {
        open01 = val;
        applyOpen();
      });
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
      openTween?.cancel();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      texture?.dispose();
      creaseLines?.geometry.dispose();
      if (creaseLines) {
        (creaseLines.material as THREE.Material).dispose();
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      for (const e of byId.values()) {
        e.mesh.geometry.dispose();
      }
      faceMat.dispose();
      kraftMat.dispose();
      renderer.dispose();
    },
  };
}
