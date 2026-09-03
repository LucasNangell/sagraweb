import * as THREE from "three";

import {
  adjacentMovingPanelId,
  evaluateFoldState,
  makeIdentityPanelMatrices,
  resolveWorldHinge,
  type PanelMatrixMap,
  type ResolveMovingFn,
} from "./foldKinematics";
import { panelId, quantizeMm, uniqueSortedBreaks } from "./foldNormalization";
import type {
  FoldAdjacencyEdge,
  FoldCrease,
  FoldMovingSide,
  FoldOperation,
  FoldPanelTopology,
  FoldSheetDefinition,
  FoldTopology,
} from "./foldTypes";

/** Progresso com ops anteriores à corrente fechadas (wizard / validação). */
export function progressWithPriorsClosed(
  operations: FoldOperation[],
  current: FoldOperation,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of operations) {
    out.set(o.id, o.order < current.order ? 0 : 1);
  }
  return out;
}

export function buildFoldTopology(def: FoldSheetDefinition): FoldTopology {
  const widthMm = quantizeMm(def.widthMm);
  const heightMm = quantizeMm(def.heightMm);
  const vCuts = def.creases
    .filter((c) => c.axis === "vertical")
    .map((c) => c.positionMm);
  const hCuts = def.creases
    .filter((c) => c.axis === "horizontal")
    .map((c) => c.positionMm);
  const xBreaks = uniqueSortedBreaks(widthMm, vCuts);
  const yBreaks = uniqueSortedBreaks(heightMm, hCuts);
  const multiRow = yBreaks.length > 2;

  const panels: FoldPanelTopology[] = [];
  for (let row = 0; row < yBreaks.length - 1; row++) {
    const y0 = yBreaks[row]!;
    const y1 = yBreaks[row + 1]!;
    for (let col = 0; col < xBreaks.length - 1; col++) {
      const x0 = xBreaks[col]!;
      const x1 = xBreaks[col + 1]!;
      const w = quantizeMm(x1 - x0);
      const h = quantizeMm(y1 - y0);
      panels.push({
        id: panelId(row, col, multiRow),
        row,
        column: col,
        xMm: x0,
        yMm: y0,
        widthMm: w,
        heightMm: h,
        centerMm: { x: quantizeMm(x0 + w / 2), y: quantizeMm(y0 + h / 2) },
      });
    }
  }

  const byCell = new Map<string, FoldPanelTopology>();
  for (const p of panels) byCell.set(`${p.row},${p.column}`, p);

  const edges: FoldAdjacencyEdge[] = [];
  const edgesByCrease = new Map<string, string[]>();

  const matchCrease = (
    axis: FoldCrease["axis"],
    position: number,
  ): FoldCrease | undefined => {
    const q = quantizeMm(position);
    return def.creases.find(
      (c) => c.axis === axis && Math.abs(quantizeMm(c.positionMm) - q) < 0.06,
    );
  };

  const cols = xBreaks.length - 1;
  const rows = yBreaks.length - 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = byCell.get(`${row},${col}`)!;
      const b = byCell.get(`${row},${col + 1}`)!;
      const cut = quantizeMm(a.xMm + a.widthMm);
      const crease = matchCrease("vertical", cut);
      if (!crease) continue;
      const edge: FoldAdjacencyEdge = {
        id: `e-${a.id}-${b.id}`,
        panelAId: a.id,
        panelBId: b.id,
        creaseId: crease.id,
        localSegment: {
          start: { x: cut, y: a.yMm },
          end: { x: cut, y: a.yMm + a.heightMm },
        },
      };
      edges.push(edge);
      const list = edgesByCrease.get(crease.id) ?? [];
      list.push(edge.id);
      edgesByCrease.set(crease.id, list);
    }
  }

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols; col++) {
      const a = byCell.get(`${row},${col}`)!;
      const b = byCell.get(`${row + 1},${col}`)!;
      const cut = quantizeMm(a.yMm + a.heightMm);
      const crease = matchCrease("horizontal", cut);
      if (!crease) continue;
      const edge: FoldAdjacencyEdge = {
        id: `e-${a.id}-${b.id}`,
        panelAId: a.id,
        panelBId: b.id,
        creaseId: crease.id,
        localSegment: {
          start: { x: a.xMm, y: cut },
          end: { x: a.xMm + a.widthMm, y: cut },
        },
      };
      edges.push(edge);
      const list = edgesByCrease.get(crease.id) ?? [];
      list.push(edge.id);
      edgesByCrease.set(crease.id, list);
    }
  }

  return { widthMm, heightMm, panels, edges, edgesByCrease };
}

function neighbors(
  edges: FoldAdjacencyEdge[],
  panelIdStr: string,
): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.panelAId === panelIdStr) out.push(e.panelBId);
    else if (e.panelBId === panelIdStr) out.push(e.panelAId);
  }
  return out;
}

/**
 * Remove arestas do vinco e BFS a partir de uma semente no lado móvel.
 */
export function resolveMovingPanels(
  topology: FoldTopology,
  operation: FoldOperation,
  creases: FoldCrease[],
): Set<string> {
  const crease = creases.find((c) => c.id === operation.creaseId);
  if (!crease) return new Set();

  const creaseEdgeIds = new Set(topology.edgesByCrease.get(crease.id) ?? []);
  const remaining = topology.edges.filter((e) => !creaseEdgeIds.has(e.id));
  const seeds = pickSeedPanels(topology, crease, operation.movingSide);
  if (seeds.length === 0) return new Set();

  const visited = new Set<string>();
  const queue = [...seeds];
  for (const s of queue) visited.add(s);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(remaining, cur)) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push(n);
    }
  }

  // Se o BFS alcançou todos os painéis, a dobra não separa — inválido
  if (visited.size >= topology.panels.length) return new Set();
  return visited;
}

const WORLD_SIDE_EPS_MM = 0.75;

function hasActivePriorFold(
  operations: FoldOperation[],
  operation: FoldOperation,
  progressByOp: Map<string, number>,
): boolean {
  return operations.some(
    (o) =>
      o.id !== operation.id &&
      o.order < operation.order &&
      (progressByOp.get(o.id) ?? 1) < 1 - 1e-9,
  );
}

/**
 * Conjunto móvel com consciência de pilha: após dobras anteriores, partição
 * pelo plano do vinco no espaço mundial (ex.: zine A3→A6, 3ª dobra).
 * Sem histórico ativo, delega ao BFS plano.
 */
export function resolveMovingPanelsWithHistory(args: {
  topology: FoldTopology;
  operation: FoldOperation;
  creases: FoldCrease[];
  operations: FoldOperation[];
  progressByOp: Map<string, number>;
  /** Matrizes já com ops anteriores aplicadas (hot path do solver). */
  priorMatrices?: PanelMatrixMap;
  thicknessMm?: number;
}): Set<string> {
  const {
    topology,
    operation,
    creases,
    operations,
    progressByOp,
    thicknessMm,
  } = args;
  const flat = resolveMovingPanels(topology, operation, creases);
  if (flat.size === 0) return flat;

  if (!hasActivePriorFold(operations, operation, progressByOp)) {
    return flat;
  }

  const crease = creases.find((c) => c.id === operation.creaseId);
  if (!crease) return flat;

  let matrices = args.priorMatrices;
  if (!matrices) {
    const priorOps = operations.filter((o) => o.order < operation.order);
    const nested = evaluateFoldState({
      topology,
      creases,
      operations: priorOps,
      progressByOp,
      resolveMoving: (op, prior) =>
        resolveMovingPanelsWithHistory({
          topology,
          operation: op,
          creases,
          operations: priorOps,
          progressByOp,
          priorMatrices: prior,
          thicknessMm,
        }),
      thicknessMm,
    });
    matrices = nested.matrices;
  }

  const hinge = resolveWorldHinge(
    topology,
    crease,
    flat,
    matrices,
    operation.id,
  );
  if (!hinge.ok) return flat;

  const axis = hinge.direction.clone().normalize();
  if (axis.lengthSq() < 1e-12) return flat;

  const seedId =
    adjacentMovingPanelId(topology, crease, flat) ??
    flat.values().next().value;
  if (typeof seedId !== "string") return flat;
  const seedMat = matrices.get(seedId) ?? makeIdentityPanelMatrices(topology).get(seedId);
  if (!seedMat) return flat;

  const origin = hinge.point;
  const seedCenter = new THREE.Vector3(0, 0, 0).applyMatrix4(seedMat);
  const toSeed = seedCenter.clone().sub(origin);
  const radial = toSeed
    .clone()
    .sub(axis.clone().multiplyScalar(toSeed.dot(axis)));
  if (radial.lengthSq() < 1e-8) return flat;
  radial.normalize();

  const moving = new Set<string>();
  for (const p of topology.panels) {
    const mat = matrices.get(p.id);
    if (!mat) continue;
    const center = new THREE.Vector3(0, 0, 0).applyMatrix4(mat);
    const toP = center.clone().sub(origin);
    const radialP = toP
      .clone()
      .sub(axis.clone().multiplyScalar(toP.dot(axis)));
    const side = radialP.dot(radial);
    if (side > WORLD_SIDE_EPS_MM) {
      moving.add(p.id);
    } else if (side >= -WORLD_SIDE_EPS_MM && flat.has(p.id)) {
      // Quase no plano: só inclui se o BFS plano também marcar (evita miolo).
      moving.add(p.id);
    }
  }

  if (moving.size === 0 || moving.size >= topology.panels.length) return flat;
  return moving;
}

export function createHistoryAwareResolveMoving(args: {
  topology: FoldTopology;
  creases: FoldCrease[];
  operations: FoldOperation[];
  progressByOp: Map<string, number>;
  thicknessMm?: number;
}): ResolveMovingFn {
  return (op, priorMatrices) =>
    resolveMovingPanelsWithHistory({
      topology: args.topology,
      operation: op,
      creases: args.creases,
      operations: args.operations,
      progressByOp: args.progressByOp,
      priorMatrices,
      thicknessMm: args.thicknessMm,
    });
}

/**
 * Aviso: grade 2×3 com V→H→V no vinco interior da aba já fechada
 * (descasca uma coluna). Sugerir preset zine 2×4.
 */
export function detectInteriorPeelAfterFlap(
  topology: FoldTopology,
  creases: FoldCrease[],
  operations: FoldOperation[],
): { code: string; message: string } | null {
  const cols = new Set(topology.panels.map((p) => p.column)).size;
  const rows = new Set(topology.panels.map((p) => p.row)).size;
  if (cols !== 3 || rows !== 2) return null;

  const sorted = [...operations].sort((a, b) => a.order - b.order);
  if (sorted.length < 3) return null;
  const [o1, o2, o3] = sorted;
  if (!o1 || !o2 || !o3) return null;

  const c1 = creases.find((c) => c.id === o1.creaseId);
  const c2 = creases.find((c) => c.id === o2.creaseId);
  const c3 = creases.find((c) => c.id === o3.creaseId);
  if (!c1 || !c2 || !c3) return null;
  if (c1.axis !== "vertical" || c2.axis !== "horizontal" || c3.axis !== "vertical") {
    return null;
  }
  if (c1.id === c3.id) return null;

  const m1 = resolveMovingPanels(topology, o1, creases);
  const m3 = resolveMovingPanels(topology, o3, creases);
  if (m1.size === 0 || m3.size === 0) return null;
  // 3ª é subconjunto próprio da 1ª → descasca interior da aba
  let subset = m3.size < m1.size;
  if (!subset) return null;
  for (const id of m3) {
    if (!m1.has(id)) {
      subset = false;
      break;
    }
  }
  if (!subset) return null;

  return {
    code: "interior_peel_zine",
    message:
      "A 3ª dobra vertical separa só uma coluna da aba já fechada. Para zine A3→A6 (metades sucessivas), use o preset “Zine A3→A6” (grade 2×4).",
  };
}

function pickSeedPanels(
  topology: FoldTopology,
  crease: FoldCrease,
  side: FoldMovingSide,
): string[] {
  const pos = quantizeMm(crease.positionMm);
  const out: string[] = [];
  for (const p of topology.panels) {
    if (crease.axis === "vertical") {
      const onNeg = p.xMm + p.widthMm <= pos + 0.06;
      const onPos = p.xMm >= pos - 0.06;
      if (side === "negative" && onNeg) out.push(p.id);
      if (side === "positive" && onPos) out.push(p.id);
    } else {
      const onNeg = p.yMm + p.heightMm <= pos + 0.06;
      const onPos = p.yMm >= pos - 0.06;
      if (side === "negative" && onNeg) out.push(p.id);
      if (side === "positive" && onPos) out.push(p.id);
    }
  }
  // Prefer seeds that touch the crease (adjacent)
  const edgeIds = topology.edgesByCrease.get(crease.id) ?? [];
  const edgePanels = new Set<string>();
  for (const eid of edgeIds) {
    const e = topology.edges.find((x) => x.id === eid);
    if (!e) continue;
    edgePanels.add(e.panelAId);
    edgePanels.add(e.panelBId);
  }
  const touching = out.filter((id) => edgePanels.has(id));
  return touching.length ? touching : out;
}

/**
 * Escolhe `movingSide` de forma que `basePanelId` fique no lado parado
 * (não entre no conjunto móvel). Útil para miolo de carteira.
 */
export function resolveMovingSideForBase(
  topology: FoldTopology,
  crease: FoldCrease,
  creases: FoldCrease[],
  basePanelId: string,
  opTemplate?: Pick<FoldOperation, "id" | "creaseId" | "order">,
): FoldMovingSide | null {
  const proto = {
    id: opTemplate?.id ?? "tmp",
    creaseId: crease.id,
    order: opTemplate?.order ?? 1,
    towards: "front" as const,
    targetAngleDeg: 180,
  };
  for (const side of ["negative", "positive"] as FoldMovingSide[]) {
    const moving = resolveMovingPanels(
      topology,
      { ...proto, movingSide: side },
      creases,
    );
    if (moving.size > 0 && !moving.has(basePanelId)) return side;
  }
  return null;
}

/**
 * Ajusta `movingSide` de todas as operações para que o painel base não se mova.
 */
export function syncOperationsToBasePanel(
  topology: FoldTopology,
  creases: FoldCrease[],
  operations: FoldOperation[],
  basePanelId: string | null | undefined,
): FoldOperation[] {
  if (!basePanelId) return operations;
  return operations.map((o) => {
    const crease = creases.find((c) => c.id === o.creaseId);
    if (!crease) return o;
    const side = resolveMovingSideForBase(
      topology,
      crease,
      creases,
      basePanelId,
      o,
    );
    return side && side !== o.movingSide ? { ...o, movingSide: side } : o;
  });
}

export function stationaryPanels(
  topology: FoldTopology,
  moving: Set<string>,
): string[] {
  return topology.panels.map((p) => p.id).filter((id) => !moving.has(id));
}
