import * as THREE from "three";

import { duplexBackBandMm } from "./foldDuplex";
import type { ArtworkTransform, FoldPanelTopology } from "./foldTypes";

/**
 * UVs do painel na folha.
 *
 * Duplex “turn” (mirrorX): remapeia a faixa da folha L↔R — o painel esquerdo
 * amostra a faixa direita do PDF de verso — sem inverter a varredura dentro
 * do painel (texto permanece legível). Não usar flip de textura (repeat.x=-1):
 * isso espelha os glifos.
 */
export function panelUVs(
  panel: FoldPanelTopology,
  pageW: number,
  pageH: number,
  transform: ArtworkTransform,
): THREE.Float32BufferAttribute {
  const band = duplexBackBandMm(
    panel.xMm,
    panel.widthMm,
    pageW,
    Boolean(transform.mirrorX),
  );
  let u0 = band.u0;
  let u1 = band.u1;
  let vTop = 1 - panel.yMm / pageH;
  let vBot = 1 - (panel.yMm + panel.heightMm) / pageH;

  // Frente nunca usa mirrorX; se chegar mirrorY só no verso.
  if (transform.mirrorY) {
    const a = 1 - vTop;
    const b = 1 - vBot;
    vTop = a;
    vBot = b;
  }

  // PlaneGeometry (Three r185): vértices TL, TR, BL, BR — não BL,BR,TL,TR
  return new THREE.Float32BufferAttribute(
    [u0, vTop, u1, vTop, u0, vBot, u1, vBot],
    2,
  );
}

export type PanelMeshBundle = {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  disposables: Array<{ dispose: () => void }>;
};

export function createPanelBoxMesh(args: {
  panel: FoldPanelTopology;
  pageW: number;
  pageH: number;
  thickness: number;
  frontTex: THREE.Texture | null;
  backTex: THREE.Texture | null;
  frontTransform: ArtworkTransform;
  backTransform: ArtworkTransform;
  faithfulColors: boolean;
}): PanelMeshBundle {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = args.panel.id;
  group.userData["panelId"] = args.panel.id;

  const w = args.panel.widthMm;
  const h = args.panel.heightMm;
  const t = Math.max(0.02, args.thickness);

  const geo = new THREE.BoxGeometry(w, h, t);
  disposables.push(geo);

  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xd4cfc4,
    toneMapped: false,
  });
  disposables.push(edgeMat);

  // +z/-z sólidos sem textura — evita z-fight com os planos de arte
  const faceCap = new THREE.MeshBasicMaterial({
    color: 0xf0ebe3,
    toneMapped: false,
  });
  disposables.push(faceCap);

  const box = new THREE.Mesh(geo, [
    edgeMat,
    edgeMat,
    edgeMat,
    edgeMat,
    faceCap,
    faceCap,
  ]);
  box.userData["panelId"] = args.panel.id;
  // Box só para volume/bordas; raycast e arte nos planos
  box.raycast = () => {};
  group.add(box);

  const mkFaceMat = (
    map: THREE.Texture | null,
    fallback: number,
    faithful: boolean,
    polygonOffsetFactor: number,
  ) => {
    const common = {
      map: map ?? undefined,
      color: map ? 0xffffff : fallback,
      side: THREE.FrontSide as THREE.Side,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits: 1,
    };
    if (faithful) {
      const m = new THREE.MeshBasicMaterial({
        ...common,
        toneMapped: false,
      });
      disposables.push(m);
      return m;
    }
    const m = new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.72,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.35,
    });
    disposables.push(m);
    return m;
  };

  // Arte colada à superfície (gap mínimo) para a dobra parecer contínua
  const zGap = Math.max(0.008, t * 0.08);

  const frontPlane = new THREE.PlaneGeometry(w, h);
  frontPlane.setAttribute(
    "uv",
    panelUVs(args.panel, args.pageW, args.pageH, args.frontTransform),
  );
  disposables.push(frontPlane);
  const frontMesh = new THREE.Mesh(
    frontPlane,
    mkFaceMat(args.frontTex, 0xf7f4ef, args.faithfulColors, -1),
  );
  frontMesh.position.z = t / 2 + zGap;
  frontMesh.userData["panelId"] = args.panel.id;
  group.add(frontMesh);

  const backPlane = new THREE.PlaneGeometry(w, h);
  backPlane.setAttribute(
    "uv",
    panelUVs(args.panel, args.pageW, args.pageH, args.backTransform),
  );
  disposables.push(backPlane);
  const backMesh = new THREE.Mesh(
    backPlane,
    mkFaceMat(args.backTex, 0xffffff, args.faithfulColors, -1),
  );
  // Rotação Y=π: verso olha para −Z. Remap duplex fica nos UVs (mirrorX).
  backMesh.rotation.y = Math.PI;
  backMesh.position.z = -(t / 2 + zGap);
  backMesh.userData["panelId"] = args.panel.id;
  group.add(backMesh);

  return { group, meshes: [frontMesh, backMesh], disposables };
}
