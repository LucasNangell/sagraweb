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
