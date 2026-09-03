import * as THREE from "three";

import type {
  FoldCrease,
  FoldOperation,
  ProvaWebFoldMockupMeta,
} from "@/api/provaWeb";

import { contentBoundingSphere, fitCameraToSphere } from "./foldCamera";
import { computeSafeAngleOverrides } from "./foldCollision";
import { createPanelBoxMesh } from "./foldGeometry";
import {
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  MAX_ROT_X,
  ORBIT_SENS_X,
  ORBIT_SENS_Y,
  pickPanelId,
} from "./foldInteraction";
import {
  evaluateFoldState,
  matrixIsFinite,
  type PanelMatrixMap,
} from "./foldKinematics";
import { addStudioLights, configureRenderer, type ColorMode } from "./foldMaterials";
import { resolveOperationProgress } from "./foldProgress";
import { resolvePhysical, renderThicknessMm } from "./foldStacking";
import { buildFoldTopology, resolveMovingPanels } from "./foldTopology";
import type {
  ArtworkTransform,
  FoldSheetDefinition,
  FoldTopology,
} from "./foldTypes";
import { DEFAULT_ARTWORK_BACK } from "./foldTypes";
import { hasBlockingErrors, validateFoldDefinition } from "./foldValidation";

export {
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  MAX_ROT_X,
  ORBIT_SENS_X,
  ORBIT_SENS_Y,
} from "./foldInteraction";

export type FoldSceneHandle = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbitGroup: THREE.Group;
  pivotGroup: THREE.Group;
  contentGroup: THREE.Group;
  topology: FoldTopology;
  operations: FoldOperation[];
  setOrbit: (rotX: number, rotY: number) => void;
  setHingeAnglesFromUnfold: (unfold01: number) => void;
  setZoom: (factor: number) => void;
  fitView: () => void;
  pickPanel: (ndcX: number, ndcY: number) => string | null;
  operationForPanel: (panelId: string, unfold01: number) => string | null;
  setOperationProgress: (operationId: string, open01: number) => void;
  getErrors: () => string[];
  requestRender: () => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  dispose: () => void;
  /** Compat: unused in new engine */
  hinges: never[];
  panelMeshes: THREE.Mesh[];
  recenterPivot: () => void;
  pickHingeNear: () => null;
};

async function loadTexture(url: string | null): Promise<THREE.Texture | null> {
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
          tex.anisotropy = 8;
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

function definitionFromMeta(
  foldMockup: ProvaWebFoldMockupMeta,
): FoldSheetDefinition {
  const physical = resolvePhysical(foldMockup.physical);
  return {
    widthMm: foldMockup.pageWidthMm,
    heightMm: foldMockup.pageHeightMm,
    thicknessMm: renderThicknessMm(physical),
    creases: foldMockup.creases ?? [],
    operations: foldMockup.operations ?? [],
    backArtworkTransform:
      foldMockup.backArtworkTransform ?? DEFAULT_ARTWORK_BACK,
    physical,
  };
}

export async function createFoldScene(
  canvas: HTMLCanvasElement,
  foldMockup: ProvaWebFoldMockupMeta,
  frontUrl: string | null,
  backUrl: string | null,
  options?: {
    colorMode?: ColorMode;
    maxPixelRatio?: number;
    /** Padding do enquadramento (1 = justo; maior = mais folga). Padrão 1.08. */
    fitPadding?: number;
  },
): Promise<FoldSceneHandle> {
  const colorMode: ColorMode = options?.colorMode ?? "faithful";
  const maxPixelRatio = Math.max(1, options?.maxPixelRatio ?? 2);
  const fitPaddingBase = Math.max(
    1.01,
    Math.min(1.6, options?.fitPadding ?? 1.08),
  );
  const def = definitionFromMeta(foldMockup);
  const issues = validateFoldDefinition(def);
  if (hasBlockingErrors(issues) || foldMockup.ready === false) {
    throw new Error(
      issues.find((i) => i.level === "error")?.message ??
        "Configuração de dobra inválida.",
    );
  }

  const topology = buildFoldTopology(def);
  const physical = def.physical;
  const thickness = renderThicknessMm(physical);

  const [frontTex, backTex] = await Promise.all([
    loadTexture(frontUrl),
    foldMockup.hasVerso ? loadTexture(backUrl) : Promise.resolve(null),
  ]);

  const disposables: Array<{ dispose: () => void }> = [];
  if (frontTex) disposables.push(frontTex);
  if (backTex) disposables.push(backTex);

  const frontXform: ArtworkTransform = {
    mirrorX: false,
    mirrorY: false,
    rotationDeg: 0,
  };
  // Duplex turn via UV (mirrorX): L↔R de faixa na folha, texto sem espelho.
  const backXform: ArtworkTransform = {
    mirrorX: Boolean(def.backArtworkTransform?.mirrorX ?? DEFAULT_ARTWORK_BACK.mirrorX),
    mirrorY: Boolean(def.backArtworkTransform?.mirrorY),
    rotationDeg: def.backArtworkTransform?.rotationDeg ?? 0,
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc5d0dc);

  const camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
  const orbitGroup = new THREE.Group();
  const pivotGroup = new THREE.Group();
  const contentGroup = new THREE.Group();
  pivotGroup.add(contentGroup);
  orbitGroup.add(pivotGroup);
  scene.add(orbitGroup);

  const panelGroups = new Map<string, THREE.Group>();
  const panelMeshes: THREE.Mesh[] = [];

  for (const panel of topology.panels) {
    const built = createPanelBoxMesh({
      panel,
      pageW: def.widthMm,
      pageH: def.heightMm,
      thickness,
      frontTex,
      backTex,
      frontTransform: frontXform,
      backTransform: backXform,
      faithfulColors: colorMode === "faithful",
    });
    disposables.push(...built.disposables);
    panelMeshes.push(...built.meshes);
    panelGroups.set(panel.id, built.group);
    contentGroup.add(built.group);
  }

  if (colorMode === "studio") {
    addStudioLights(scene, Math.max(def.widthMm, def.heightMm));
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, maxPixelRatio),
  );
  configureRenderer(renderer, colorMode);

  const raycaster = new THREE.Raycaster();
  let rotX = DEFAULT_ROT_X;
  let rotY = DEFAULT_ROT_Y;
  let zoom = 1;
  let lastErrors: string[] = [];
  let pendingRender = true;
  let opProgressOverride: Map<string, number> | null = null;

  const applyMatrices = (
    matrices: PanelMatrixMap,
    panelLayer?: Map<string, number>,
  ) => {
    for (const [id, mat] of matrices) {
      if (!matrixIsFinite(mat)) continue;
      const g = panelGroups.get(id);
      if (!g) continue;
      g.matrixAutoUpdate = false;
      g.matrix.copy(mat);
      g.updateMatrixWorld(true);
      const layer = panelLayer?.get(id) ?? 0;
      g.renderOrder = layer;
      g.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.renderOrder = layer;
          const mesh = obj as THREE.Mesh;
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const matl of mats) {
            if (
              matl &&
              "polygonOffset" in matl &&
              (matl as THREE.MeshBasicMaterial).polygonOffset
            ) {
              (matl as THREE.MeshBasicMaterial).polygonOffsetFactor =
                -1 - layer * 2;
              (matl as THREE.MeshBasicMaterial).polygonOffsetUnits = 1;
            }
          }
        }
      });
    }
  };

  const resolveMoving = (op: FoldOperation) =>
    resolveMovingPanels(topology, op, def.creases);

  const evaluate = (unfold01: number) => {
    const progress =
      opProgressOverride ??
      resolveOperationProgress(def.operations, unfold01);
    const safeAngles = computeSafeAngleOverrides({
      topology,
      creases: def.creases,
      operations: def.operations,
      progressByOp: progress,
      resolveMoving,
      thickness,
    });
    const result = evaluateFoldState({
      topology,
      creases: def.creases,
      operations: def.operations,
      progressByOp: progress,
      resolveMoving,
      angleOverride: safeAngles,
      thicknessMm: thickness,
    });
    lastErrors = result.errors;
    applyMatrices(result.matrices, result.panelLayer);
  };

  const applyFixedSheetPivot = () => {
    // Centro geométrico da folha aberta (fixo); não segue AABB dobrado.
    pivotGroup.position.set(-def.widthMm / 2, def.heightMm / 2, 0);
  };

  const recenterPivot = () => {
    applyFixedSheetPivot();
  };

  const setOrbit = (x: number, y: number) => {
    rotX = x;
    rotY = y;
    orbitGroup.rotation.order = "YXZ";
    orbitGroup.rotation.x = rotX;
    orbitGroup.rotation.y = rotY;
    pendingRender = true;
  };

  const setHingeAnglesFromUnfold = (unfold01: number) => {
    opProgressOverride = null;
    evaluate(Math.min(1, Math.max(0, unfold01)));
    // Pivot permanece no centro da folha — não recentrar no volume dobrado
    pendingRender = true;
  };

  const setOperationProgress = (operationId: string, open01: number) => {
    const base = resolveOperationProgress(def.operations, 0);
    // start from current unfold-like: merge
    if (!opProgressOverride) {
      opProgressOverride = resolveOperationProgress(def.operations, 0);
    }
    for (const [k, v] of base) {
      if (!opProgressOverride.has(k)) opProgressOverride.set(k, v);
    }
    opProgressOverride.set(operationId, Math.min(1, Math.max(0, open01)));
    evaluate(0);
    pendingRender = true;
  };

  const fitView = () => {
    const sphere = contentBoundingSphere(contentGroup);
    fitCameraToSphere(
      camera,
      sphere,
      camera.aspect,
      fitPaddingBase / zoom,
    );
    pendingRender = true;
  };

  applyFixedSheetPivot();
  setOrbit(DEFAULT_ROT_X, DEFAULT_ROT_Y);
  setHingeAnglesFromUnfold(0);

  const resize = (width: number, height: number) => {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    fitView();
  };

  const render = () => {
    if (!pendingRender) return;
    pendingRender = false;
    renderer.render(scene, camera);
  };

  const requestRender = () => {
    pendingRender = true;
  };

  const dispose = () => {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    renderer.dispose();
  };

  return {
    renderer,
    scene,
    camera,
    orbitGroup,
    pivotGroup,
    contentGroup,
    topology,
    operations: def.operations,
    setOrbit,
    setHingeAnglesFromUnfold,
    setZoom: (factor: number) => {
      zoom = Math.min(3, Math.max(0.4, factor));
      fitView();
    },
    fitView,
    pickPanel: (ndcX, ndcY) =>
      pickPanelId(
        raycaster,
        camera,
        new THREE.Vector2(ndcX, ndcY),
        panelMeshes,
      ),
    operationForPanel: (panelId, unfold01) => {
      const progress = resolveOperationProgress(def.operations, unfold01);
      // Prefer operation that still has this panel in moving set and isn't fully open
      const candidates = [...def.operations]
        .sort((a, b) => b.order - a.order)
        .filter((op) => {
          const open = progress.get(op.id) ?? 1;
          if (open >= 0.999) return false;
          return resolveMoving(op).has(panelId);
        });
      return candidates[0]?.id ?? null;
    },
    setOperationProgress,
    getErrors: () => lastErrors,
    requestRender,
    resize,
    render,
    dispose,
    hinges: [],
    panelMeshes,
    recenterPivot,
    pickHingeNear: () => null,
  };
}

export type { FoldCrease, FoldOperation } from "@/api/provaWeb";
export type { FoldPanelPageAssignment } from "./foldTypes";

