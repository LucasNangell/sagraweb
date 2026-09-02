import * as THREE from "three";

import type { ProvaWebSpiralMockupMeta } from "@/api/provaWeb";

import { configureRenderer } from "./fold-engine/foldMaterials";
import { boxCorners, spiralFitDistanceFromCorners } from "./spiralFit";

export type SpiralPageTurnArgs = {
  dir: 1 | -1;
  /** Frente da folha seguinte (após a virada). */
  nextFrontUrl: string | null;
  /**
   * Face −Z do bloco após a virada: verso da folha que passa a ser a
   * “anterior” (nunca o verso da folha atual em repouso).
   */
  blockBackUrl: string | null;
  /** Verso da folha animada (só aparece durante o flip). */
  leafBackUrl: string | null;
  /** Timings opcionais (idle mais curto para ~1 folha/s). */
  timing?: {
    durationMs?: number;
    settleMs?: number;
    fadeMs?: number;
  };
};

export type SpiralSceneHandle = {
  setOrbit: (rotXDeg: number, rotYDeg: number) => void;
  /** 1 = maior enquadramento sem cortar; maior = mais perto (clamp 0.4–3). */
  setZoom: (zoom: number) => void;
  /** Atualiza frente (+Z) e verso (−Z) do bloco sem animação. */
  setPageTextures: (
    frontUrl: string | null,
    backUrl: string | null,
  ) => Promise<void>;
  /** Anima a folha da frente ao verso (arco π); texturas sem salto no meio. */
  playPageTurn: (args: SpiralPageTurnArgs) => Promise<void>;
  requestRender: () => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  dispose: () => void;
};

async function loadTexture(
  url: string | null,
  anisotropy = 8,
): Promise<THREE.Texture | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    return await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        objUrl,
        (tex) => {
          URL.revokeObjectURL(objUrl);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.max(1, anisotropy);
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(objUrl);
          reject(err);
        },
      );
    });
  } catch {
    return null;
  }
}

function holePositionsMm(
  meta: ProvaWebSpiralMockupMeta,
): Array<{ x: number; y: number }> {
  const w = Math.max(40, meta.pageWidthMm);
  const h = Math.max(40, meta.pageHeightMm);
  const n = Math.max(4, Math.min(40, meta.holeCount || 14));
  const margin = Math.max(3, meta.marginFromEdgeMm || 8);
  const edge = meta.edge === "top" ? "top" : "left";
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    if (edge === "left") {
      out.push({ x: -w / 2 + margin, y: -h / 2 + t * h });
    } else {
      out.push({ x: -w / 2 + t * w, y: h / 2 - margin });
    }
  }
  return out;
}

/**
 * Pontos do fio: em cada furo, um loop circular no plano perpendicular à borda,
 * passando pelo centro do furo (atravessa a espessura do bloco).
 */
function buildWireCurve(
  meta: ProvaWebSpiralMockupMeta,
  depthMm: number,
): THREE.CatmullRomCurve3 {
  const edge = meta.edge === "top" ? "top" : "left";
  const holes = holePositionsMm(meta);
  const R = Math.max(depthMm * 0.62 + 2.8, (meta.holeDiameterMm || 5) * 1.05);
  const pts: THREE.Vector3[] = [];
  const stepsPerLoop = 28;

  for (let i = 0; i < holes.length; i++) {
    const { x: hx, y: hy } = holes[i]!;
    // Avanço helicoidal leve entre furos (y ou x)
    for (let s = 0; s <= stepsPerLoop; s++) {
      const u = s / stepsPerLoop;
      // θ=0: através do furo (borda útil); θ=π: arco externo
      const theta = u * Math.PI * 2;
      if (edge === "left") {
        const cx = hx - R;
        const x = cx + R * Math.cos(theta);
        const z = R * Math.sin(theta);
        // blend de y para o próximo furo no último quarto do loop
        let y = hy;
        if (i < holes.length - 1 && u > 0.75) {
          const next = holes[i + 1]!;
          const blend = (u - 0.75) / 0.25;
          y = hy + (next.y - hy) * blend * 0.35;
        }
        pts.push(new THREE.Vector3(x, y, z));
      } else {
        const cy = hy + R;
        const y = cy - R * Math.cos(theta);
        const z = R * Math.sin(theta);
        let x = hx;
        if (i < holes.length - 1 && u > 0.75) {
          const next = holes[i + 1]!;
          const blend = (u - 0.75) / 0.25;
          x = hx + (next.x - hx) * blend * 0.35;
        }
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
  }

  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
}

function paperEdgeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xe8e4dc,
    toneMapped: false,
  });
}

function blockStripeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xf0ebe3,
    toneMapped: false,
  });
}

/**
 * Mockup 3D espiral isolado (não usa fold-engine de dobras).
 * Bloco texturizado + furos + tubo metálico passando pelos furos.
 */
export async function createSpiralScene(
  canvas: HTMLCanvasElement,
  spiralMockup: ProvaWebSpiralMockupMeta,
  frontUrl: string | null,
  backUrl: string | null,
): Promise<SpiralSceneHandle> {
  const w = Math.max(40, spiralMockup.pageWidthMm);
  const h = Math.max(40, spiralMockup.pageHeightMm);
  const d = Math.max(4, spiralMockup.blockThicknessMm ?? 8);
  const holeR = Math.max(1, (spiralMockup.holeDiameterMm || 5) / 2);
  const edge = spiralMockup.edge === "top" ? "top" : "left";

  const [frontTex, backTex] = await Promise.all([
    loadTexture(frontUrl),
    loadTexture(backUrl),
  ]);

  const disposables: Array<{ dispose: () => void }> = [];
  if (frontTex) disposables.push(frontTex);
  if (backTex) disposables.push(backTex);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc5d0dc);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 8000);
  const orbitGroup = new THREE.Group();
  const contentGroup = new THREE.Group();
  orbitGroup.add(contentGroup);
  scene.add(orbitGroup);

  const frontMat = new THREE.MeshBasicMaterial({
    map: frontTex ?? undefined,
    color: frontTex ? 0xffffff : 0xf8f6f2,
    toneMapped: false,
  });
  const backMat = new THREE.MeshBasicMaterial({
    map: backTex ?? undefined,
    color: backTex ? 0xffffff : 0xf4f1ea,
    toneMapped: false,
  });
  disposables.push(frontMat, backMat);

  const edgeMat = paperEdgeMaterial();
  const bindMat = blockStripeMaterial();
  disposables.push(edgeMat, bindMat);

  // Box material order: +x, -x, +y, -y, +z, -z
  const boxMats = [
    edgeMat, // +x corte
    bindMat, // -x borda binding (left)
    edgeMat.clone(), // +y topo
    edgeMat.clone(), // -y base
    frontMat, // +z frente
    backMat, // -z verso
  ];
  disposables.push(boxMats[2]!, boxMats[3]!);

  const book = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMats);
  contentGroup.add(book);

  // Furos: cilindros escuros atravessando a espessura
  const holeMat = new THREE.MeshBasicMaterial({
    color: 0x1e293b,
    toneMapped: false,
  });
  disposables.push(holeMat);
  const holes = holePositionsMm(spiralMockup);
  for (const hole of holes) {
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(holeR * 1.02, holeR * 1.02, d + 0.5, 24),
      holeMat,
    );
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(hole.x, hole.y, 0);
    cyl.renderOrder = 2;
    contentGroup.add(cyl);

    // Anéis nas faces (ênfase do furo)
    const ringGeo = new THREE.RingGeometry(holeR * 0.92, holeR * 1.25, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    disposables.push(ringGeo, ringMat);
    for (const z of [d / 2 + 0.05, -d / 2 - 0.05]) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(hole.x, hole.y, z);
      ring.renderOrder = 3;
      contentGroup.add(ring);
    }
  }

  // Espiral tubular pelos furos
  const curve = buildWireCurve(spiralMockup, d);
  const tubularSegments = Math.max(160, holes.length * 40);
  const wireR = Math.max(0.4, Math.min(holeR * 0.42, holeR - 0.15));
  const tubeGeo = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    wireR,
    12,
    false,
  );
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad,
    roughness: 0.22,
    metalness: 0.95,
  });
  disposables.push(tubeGeo, wireMat);
  const wire = new THREE.Mesh(tubeGeo, wireMat);
  wire.renderOrder = 4;
  contentGroup.add(wire);

  const maxDim = Math.max(w, h, d * 4);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const wireKey = new THREE.DirectionalLight(0xffffff, 0.55);
  wireKey.position.set(maxDim * 0.55, maxDim * 0.9, maxDim * 0.7);
  scene.add(wireKey);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  configureRenderer(renderer, "faithful");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const textureAnisotropy = renderer.capabilities.getMaxAnisotropy();
  if (frontTex) {
    frontTex.anisotropy = textureAnisotropy;
    frontTex.needsUpdate = true;
  }
  if (backTex) {
    backTex.anisotropy = textureAnisotropy;
    backTex.needsUpdate = true;
  }

  let disposed = false;
  let needsRender = true;
  let rafScheduled = false;
  let rotX = -14;
  let rotY = -32;
  let zoom = 1;
  let viewW = 1;
  let viewH = 1;

  const applyOrbit = () => {
    orbitGroup.rotation.order = "YXZ";
    orbitGroup.rotation.x = THREE.MathUtils.degToRad(rotX);
    orbitGroup.rotation.y = THREE.MathUtils.degToRad(rotY);
  };
  applyOrbit();

  const fitCamera = (width: number, height: number) => {
    viewW = Math.max(1, width);
    viewH = Math.max(1, height);
    const aspect = Math.max(0.2, viewW / viewH);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    orbitGroup.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(orbitGroup);
    const center = new THREE.Vector3();
    if (box.isEmpty()) {
      center.set(0, 0, 0);
      box.setFromCenterAndSize(center, new THREE.Vector3(100, 100, 20));
    } else {
      box.getCenter(center);
    }
    const dist =
      spiralFitDistanceFromCorners(
        boxCorners(box.min, box.max),
        center,
        camera.fov,
        aspect,
      ) / Math.max(0.4, zoom);
    camera.position.set(center.x, center.y, center.z + dist);
    camera.near = Math.max(0.2, dist / 100);
    camera.far = dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  const render = () => {
    if (disposed) return;
    renderer.render(scene, camera);
    needsRender = false;
  };

  const requestRender = () => {
    if (disposed) return;
    needsRender = true;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (!disposed && needsRender) render();
    });
  };

  const setOrbit = (rotXDeg: number, rotYDeg: number) => {
    rotX = rotXDeg;
    rotY = rotYDeg;
    applyOrbit();
    fitCamera(viewW, viewH);
    requestRender();
  };

  const setZoom = (factor: number) => {
    zoom = Math.min(3, Math.max(0.4, factor));
    fitCamera(viewW, viewH);
    requestRender();
  };

  let currentFrontTex: THREE.Texture | null = frontTex;
  let currentBackTex: THREE.Texture | null = backTex;
  let turnBusy = false;
  let turnRaf = 0;

  const releaseTex = (tex: THREE.Texture | null, keep: THREE.Texture | null) => {
    if (!tex || tex === keep) return;
    const idx = disposables.indexOf(tex);
    if (idx >= 0) disposables.splice(idx, 1);
    tex.dispose();
  };

  const assignFace = (
    which: "front" | "back",
    tex: THREE.Texture | null,
    opts?: { deferDispose?: THREE.Texture | null },
  ) => {
    if (which === "front") {
      const prev = currentFrontTex;
      currentFrontTex = tex;
      if (tex) disposables.push(tex);
      frontMat.map = tex;
      frontMat.color.set(tex ? 0xffffff : 0xf8f6f2);
      frontMat.needsUpdate = true;
      if (prev && prev !== opts?.deferDispose) {
        releaseTex(prev, currentBackTex);
      }
    } else {
      const prev = currentBackTex;
      currentBackTex = tex;
      if (tex) disposables.push(tex);
      backMat.map = tex;
      backMat.color.set(tex ? 0xffffff : 0xf4f1ea);
      backMat.needsUpdate = true;
      if (prev && prev !== opts?.deferDispose) {
        releaseTex(prev, currentFrontTex);
      }
    }
  };

  const setPageTextures = async (
    frontUrl: string | null,
    backUrl: string | null,
  ) => {
    if (disposed) return;
    const [f, b] = await Promise.all([
      loadTexture(frontUrl, textureAnisotropy),
      loadTexture(backUrl, textureAnisotropy),
    ]);
    if (disposed) {
      f?.dispose();
      b?.dispose();
      return;
    }
    assignFace("front", f);
    assignFace("back", b);
    requestRender();
  };

  const playPageTurn = async (args: SpiralPageTurnArgs) => {
    if (disposed || turnBusy) return;
    turnBusy = true;
    const { dir, nextFrontUrl, blockBackUrl, leafBackUrl } = args;
    const forward = dir > 0;
    const shareLeafAndBlockBack =
      Boolean(leafBackUrl) && leafBackUrl === blockBackUrl;

    const [nextFront, blockBack, leafBackDistinct] = await Promise.all([
      loadTexture(nextFrontUrl, textureAnisotropy),
      loadTexture(blockBackUrl, textureAnisotropy),
      shareLeafAndBlockBack
        ? Promise.resolve(null)
        : loadTexture(leafBackUrl, textureAnisotropy),
    ]);
    if (disposed) {
      nextFront?.dispose();
      blockBack?.dispose();
      leafBackDistinct?.dispose();
      turnBusy = false;
      return;
    }

    const leafBack = leafBackDistinct ?? blockBack;
    const leavingFront = currentFrontTex;
    const prevBlockBack = currentBackTex;
    const leafFrontTex = forward ? leavingFront : nextFront;
    const leafBackTex = leafBack;

    // Ida: só revela a próxima frente sob a folha. O verso do bloco
    // continua sendo o da folha anterior até o flip terminar.
    if (forward) {
      assignFace("front", nextFront, { deferDispose: leavingFront });
    }

    const leafGroup = new THREE.Group();
    const leafGeo = new THREE.PlaneGeometry(w, h);
    const matFront = new THREE.MeshBasicMaterial({
      map: leafFrontTex ?? undefined,
      color: leafFrontTex ? 0xffffff : 0xf8f6f2,
      side: THREE.FrontSide,
      depthWrite: true,
      transparent: true,
      opacity: 1,
      toneMapped: false,
    });
    let versoMap: THREE.Texture | null = null;
    if (leafBackTex) {
      versoMap = leafBackTex.clone();
      versoMap.wrapS = THREE.RepeatWrapping;
      versoMap.repeat.x = -1;
      versoMap.offset.x = 1;
      versoMap.needsUpdate = true;
    }
    const matBackLeaf = new THREE.MeshBasicMaterial({
      map: versoMap ?? undefined,
      color: leafBackTex ? 0xffffff : 0xf0ebe3,
      side: THREE.FrontSide,
      depthWrite: true,
      transparent: true,
      opacity: 1,
      toneMapped: false,
    });
    const meshF = new THREE.Mesh(leafGeo, matFront);
    const meshB = new THREE.Mesh(leafGeo, matBackLeaf);
    meshB.rotation.y = Math.PI;
    meshB.position.z = -0.08;
    meshF.position.z = 0.08;
    meshF.renderOrder = 10;
    meshB.renderOrder = 10;
    leafGroup.add(meshF, meshB);

    const pivot = new THREE.Group();
    contentGroup.add(pivot);
    pivot.add(leafGroup);

    // Hinge fixo no eixo da espiral (meio da espessura) — a borda da folha
    // permanece no coil; o offset em Z coloca a folha na face da frente.
    const gap = 0.35;
    const leafZ = d / 2 + gap;
    // Sentido: peels em direção à câmera e pousa do outro lado da espiral.
    const startAng = forward ? 0 : -Math.PI;
    const endAng = forward ? -Math.PI : 0;
    const duration = Math.max(280, args.timing?.durationMs ?? 900);
    const settleMs = Math.max(0, args.timing?.settleMs ?? 140);
    const fadeDur = Math.max(40, args.timing?.fadeMs ?? 160);

    const applyPose = (eased: number) => {
      const ang = startAng + (endAng - startAng) * eased;
      if (edge === "left") {
        pivot.position.set(-w / 2, 0, 0);
        pivot.rotation.set(0, ang, 0);
        leafGroup.position.set(w / 2, 0, leafZ);
      } else {
        pivot.position.set(0, h / 2, 0);
        // Mesmo arco em X: topo no hinge, sem inverter cabeça/pé no pouso
        pivot.rotation.set(ang, 0, 0);
        leafGroup.position.set(0, -h / 2, leafZ);
      }
    };
    applyPose(0);

    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (disposed) {
          resolve();
          return;
        }
        const p = Math.min(1, (now - t0) / duration);
        const eased =
          p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        applyPose(eased);
        requestRender();
        if (p < 1) {
          turnRaf = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      turnRaf = requestAnimationFrame(tick);
    });

    if (disposed) {
      turnBusy = false;
      return;
    }

    // Pouso ancorado do outro lado da espiral (não some no meio do arco)
    applyPose(1);
    requestRender();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, settleMs);
    });

    if (!forward) {
      assignFace("front", nextFront, { deferDispose: leavingFront });
    }
    // Após o flip: verso do bloco = verso da folha que acabou de virar
    // (passa a ser a “anterior”), não o verso da nova folha atual.
    assignFace("back", blockBack, { deferDispose: prevBlockBack });

    // Dissolve só depois de pousar (não no meio do arco)
    const fadeT0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (disposed) {
          resolve();
          return;
        }
        const u = Math.min(1, (now - fadeT0) / fadeDur);
        matFront.opacity = 1 - u;
        matBackLeaf.opacity = 1 - u;
        requestRender();
        if (u < 1) {
          turnRaf = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      turnRaf = requestAnimationFrame(tick);
    });

    contentGroup.remove(pivot);
    leafGeo.dispose();
    matFront.dispose();
    matBackLeaf.dispose();
    versoMap?.dispose();
    releaseTex(leavingFront, currentFrontTex);
    releaseTex(prevBlockBack, currentBackTex);
    if (
      leafBackDistinct &&
      leafBackDistinct !== currentFrontTex &&
      leafBackDistinct !== currentBackTex
    ) {
      leafBackDistinct.dispose();
    }
    turnBusy = false;
    requestRender();
  };

  const resize = (width: number, height: number) => {
    const wPx = Math.max(1, Math.floor(width));
    const hPx = Math.max(1, Math.floor(height));
    renderer.setSize(wPx, hPx, false);
    fitCamera(wPx, hPx);
    requestRender();
  };

  const dispose = () => {
    disposed = true;
    if (turnRaf) cancelAnimationFrame(turnRaf);
    contentGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose?.();
      }
    });
    for (const d0 of disposables) d0.dispose();
    renderer.dispose();
  };

  return {
    setOrbit,
    setZoom,
    setPageTextures,
    playPageTurn,
    requestRender,
    resize,
    render,
    dispose,
  };
}
