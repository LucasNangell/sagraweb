import * as THREE from "three";

import { closedAngleRad } from "./foldProgress";
import type {
  FoldCrease,
  FoldOperation,
  FoldTopology,
  FoldTowards,
} from "./foldTypes";
import {
  AXIS_DISTANCE_EPSILON_MM,
  AXIS_PARALLEL_EPSILON,
} from "./foldTypes";

export type PanelMatrixMap = Map<string, THREE.Matrix4>;

export function makeIdentityPanelMatrices(
  topology: FoldTopology,
): PanelMatrixMap {
  const map: PanelMatrixMap = new Map();
  for (const p of topology.panels) {
    const m = new THREE.Matrix4().makeTranslation(
      p.xMm + p.widthMm / 2,
      -(p.yMm + p.heightMm / 2),
      0,
    );
    map.set(p.id, m);
  }
  return map;
}

export function makeRotationAroundLine(
  point: THREE.Vector3,
  direction: THREE.Vector3,
  angle: number,
): THREE.Matrix4 {
  const axis = direction.clone().normalize();
  const rotation = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const toOrigin = new THREE.Matrix4().makeTranslation(
    -point.x,
    -point.y,
    -point.z,
  );
  const fromOrigin = new THREE.Matrix4().makeTranslation(
    point.x,
    point.y,
    point.z,
  );
  return fromOrigin.multiply(rotation).multiply(toOrigin);
}

export function distancePointToLine(
  point: THREE.Vector3,
  linePoint: THREE.Vector3,
  lineDirection: THREE.Vector3,
): number {
  const dir = lineDirection.clone().normalize();
  const delta = point.clone().sub(linePoint);
  const proj = dir.clone().multiplyScalar(delta.dot(dir));
  return delta.sub(proj).length();
}

export function resolveRotationSign(
  hingePoint: THREE.Vector3,
  hingeAxis: THREE.Vector3,
  movingPoint: THREE.Vector3,
  frontNormal: THREE.Vector3,
  towards: FoldTowards,
): 1 | -1 {
  const probeAngle = 0.01;
  const positiveMatrix = makeRotationAroundLine(
    hingePoint,
    hingeAxis,
    probeAngle,
  );
  const moved = movingPoint.clone().applyMatrix4(positiveMatrix);
  const displacement = moved.sub(movingPoint.clone());
  const frontAmount = displacement.dot(frontNormal);
  const positiveMovesToFront = frontAmount > 0;
  if (towards === "front") {
    return positiveMovesToFront ? 1 : -1;
  }
  return positiveMovesToFront ? -1 : 1;
}

export type WorldHinge = {
  point: THREE.Vector3;
  direction: THREE.Vector3;
  ok: boolean;
  message?: string;
  /** Painel estacionário usado como âncora do vinco. */
  stationaryPanelId?: string;
};

function transformLocalPoint(
  local: { x: number; y: number },
  panelMatrix: THREE.Matrix4,
  panel: { xMm: number; yMm: number; widthMm: number; heightMm: number },
): THREE.Vector3 {
  const lx = local.x - (panel.xMm + panel.widthMm / 2);
  const ly = -(local.y - (panel.yMm + panel.heightMm / 2));
  return new THREE.Vector3(lx, ly, 0).applyMatrix4(panelMatrix);
}

function hingeFromStationaryEdge(
  topology: FoldTopology,
  crease: FoldCrease,
  moving: Set<string>,
  matrices: PanelMatrixMap,
): WorldHinge | null {
  const edgeIds = topology.edgesByCrease.get(crease.id) ?? [];
  for (const eid of edgeIds) {
    const edge = topology.edges.find((e) => e.id === eid);
    if (!edge) continue;
    const aMoving = moving.has(edge.panelAId);
    const bMoving = moving.has(edge.panelBId);
    if (aMoving === bMoving) continue;
    const stationaryId = aMoving ? edge.panelBId : edge.panelAId;
    const panel = topology.panels.find((p) => p.id === stationaryId);
    const mat = matrices.get(stationaryId);
    if (!panel || !mat) continue;
    const a = transformLocalPoint(edge.localSegment.start, mat, panel);
    const b = transformLocalPoint(edge.localSegment.end, mat, panel);
    const direction = b.clone().sub(a);
    if (direction.lengthSq() < 1e-12) continue;
    direction.normalize();
    return {
      point: a,
      direction,
      ok: true,
      stationaryPanelId: stationaryId,
    };
  }
  return null;
}

/**
 * Resolve eixo mundial a partir dos segmentos do vinco entre móvel e parado.
 * Fallback: um único segmento no painel estacionário adjacente (carteira 2ª dobra).
 */
export function resolveWorldHinge(
  topology: FoldTopology,
  crease: FoldCrease,
  moving: Set<string>,
  matrices: PanelMatrixMap,
  operationId: string,
): WorldHinge {
  const edgeIds = topology.edgesByCrease.get(crease.id) ?? [];
  const segments: Array<{
    a: THREE.Vector3;
    b: THREE.Vector3;
    stationaryId: string;
  }> = [];

  for (const eid of edgeIds) {
    const edge = topology.edges.find((e) => e.id === eid);
    if (!edge) continue;
    const aMoving = moving.has(edge.panelAId);
    const bMoving = moving.has(edge.panelBId);
    if (aMoving === bMoving) continue;
    const panelId = aMoving ? edge.panelBId : edge.panelAId;
    const panel = topology.panels.find((p) => p.id === panelId);
    const mat = matrices.get(panelId);
    if (!panel || !mat) continue;
    const p0 = transformLocalPoint(edge.localSegment.start, mat, panel);
    const p1 = transformLocalPoint(edge.localSegment.end, mat, panel);
    segments.push({ a: p0, b: p1, stationaryId: panelId });
  }

  if (segments.length === 0) {
    const fallback = hingeFromStationaryEdge(
      topology,
      crease,
      moving,
      matrices,
    );
    if (fallback) return fallback;
    return {
      point: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 1, 0),
      ok: false,
      message: `A operação ${operationId} não encontrou segmentos de vinco alinhados.`,
    };
  }

  // Um único segmento: aceitar direto (trifold 1D)
  if (segments.length === 1) {
    const s = segments[0]!;
    const direction = s.b.clone().sub(s.a);
    if (direction.lengthSq() < 1e-12) {
      return {
        point: s.a,
        direction: new THREE.Vector3(0, 1, 0),
        ok: false,
        message: `A operação ${operationId}: segmento de vinco degenerado.`,
      };
    }
    return {
      point: s.a.clone(),
      direction: direction.normalize(),
      ok: true,
      stationaryPanelId: s.stationaryId,
    };
  }

  const dirs = segments.map((s) => s.b.clone().sub(s.a).normalize());
  const ref = dirs[0]!;
  for (let i = 1; i < dirs.length; i++) {
    const d = Math.abs(Math.abs(dirs[i]!.dot(ref)) - 1);
    if (d > AXIS_PARALLEL_EPSILON * 1000 && d > 1e-3) {
      const fallback = hingeFromStationaryEdge(
        topology,
        crease,
        moving,
        matrices,
      );
      if (fallback) return fallback;
      return {
        point: segments[0]!.a.clone(),
        direction: ref,
        ok: false,
        message: `A dobra ${operationId} não pode ser executada: segmentos do vinco não estão paralelos.`,
      };
    }
  }

  const origin = segments[0]!.a.clone();
  // Tolerância mais folgada após 1ª dobra (pilha / float)
  const distEps = AXIS_DISTANCE_EPSILON_MM * 40;
  for (const s of segments) {
    const mid = s.a.clone().add(s.b).multiplyScalar(0.5);
    if (distancePointToLine(mid, origin, ref) > distEps) {
      const fallback = hingeFromStationaryEdge(
        topology,
        crease,
        moving,
        matrices,
      );
      if (fallback) return fallback;
      return {
        point: origin,
        direction: ref,
        ok: false,
        message: `A dobra ${operationId} não pode ser executada neste ponto porque os segmentos do vinco não estão mais alinhados.`,
      };
    }
  }

  return {
    point: origin,
    direction: ref,
    ok: true,
    stationaryPanelId: segments[0]!.stationaryId,
  };
}

/** Painéis estacionários comuns entre duas operações (âncora / miolo). */
function sharedStationary(
  a: Set<string>,
  b: Set<string>,
  allIds: string[],
): Set<string> {
  const out = new Set<string>();
  for (const id of allIds) {
    if (!a.has(id) && !b.has(id)) out.add(id);
  }
  return out;
}

/**
 * Painel móvel tocado pelo vinco (probe estável). Evita `[...moving][0]` de sets
 * grandes, que pode estar longe do eixo e dar sinal ambíguo.
 */
export function adjacentMovingPanelId(
  topology: FoldTopology,
  crease: FoldCrease,
  moving: Set<string>,
): string | null {
  const edgeIds = topology.edgesByCrease.get(crease.id) ?? [];
  for (const eid of edgeIds) {
    const edge = topology.edges.find((e) => e.id === eid);
    if (!edge) continue;
    if (moving.has(edge.panelAId) && !moving.has(edge.panelBId)) {
      return edge.panelAId;
    }
    if (moving.has(edge.panelBId) && !moving.has(edge.panelAId)) {
      return edge.panelBId;
    }
  }
  const first = moving.values().next().value;
  return typeof first === "string" ? first : null;
}

/**
 * Índice de camada (1..) para empilhar abas na mesma face/suporte.
 */
export function stackLayerIndex(
  operations: FoldOperation[],
  current: FoldOperation,
  progressByOp: Map<string, number>,
  resolveMoving: (op: FoldOperation) => Set<string>,
  allPanelIds: string[],
): number {
  const currentMoving = resolveMoving(current);
  let layer = 1;
  for (const prev of operations) {
    if (prev.id === current.id) continue;
    if (prev.order >= current.order) continue;
    if (prev.towards !== current.towards) continue;
    const open01 = progressByOp.get(prev.id) ?? 1;
    // Já começou a fechar
    if (open01 >= 1 - 1e-6) continue;
    const prevMoving = resolveMoving(prev);
    const support = sharedStationary(currentMoving, prevMoving, allPanelIds);
    if (support.size === 0) continue;
    layer += 1;
  }
  return layer;
}

export type FoldSolveResult = {
  matrices: PanelMatrixMap;
  errors: string[];
};

/**
 * Avalia estado a partir da folha aberta (determinístico).
 */
export function evaluateFoldState(args: {
  topology: FoldTopology;
  creases: FoldCrease[];
  operations: FoldOperation[];
  progressByOp: Map<string, number>;
  resolveMoving: (op: FoldOperation) => Set<string>;
  angleOverride?: Map<string, number>;
  /** Espessura render (papel + gap) para empilhamento. */
  thicknessMm?: number;
}): FoldSolveResult {
  const matrices = makeIdentityPanelMatrices(args.topology);
  /** Folha aberta: sinal de towards é sempre relativo a esta pose (estável). */
  const flatMatrices = makeIdentityPanelMatrices(args.topology);
  const errors: string[] = [];
  const sorted = [...args.operations].sort((a, b) => a.order - b.order);
  const allPanelIds = args.topology.panels.map((p) => p.id);
  const thickness = Math.max(0.05, args.thicknessMm ?? 0.235);
  // Normal da frente da folha aberta (+Z). Sinal não depende da pose intermediária.
  const frontNormal = new THREE.Vector3(0, 0, 1);

  const orders = [...new Set(sorted.map((o) => o.order))].sort((a, b) => a - b);

  for (const order of orders) {
    const batch = sorted.filter((o) => o.order === order);
    const before = new Map(
      [...matrices.entries()].map(([k, v]) => [k, v.clone()]),
    );

    for (const operation of batch) {
      const open01 = args.progressByOp.get(operation.id) ?? 1;
      if (open01 >= 1 - 1e-9) continue;

      const moving = args.resolveMoving(operation);
      if (moving.size === 0) continue;

      const crease = args.creases.find((c) => c.id === operation.creaseId);
      if (!crease) continue;

      const hinge = resolveWorldHinge(
        args.topology,
        crease,
        moving,
        before,
        operation.id,
      );
      if (!hinge.ok) {
        errors.push(hinge.message ?? "Eixo inválido");
        continue;
      }

      const flatHinge = resolveWorldHinge(
        args.topology,
        crease,
        moving,
        flatMatrices,
        operation.id,
      );
      if (!flatHinge.ok) {
        errors.push(
          flatHinge.message ??
            `A operação ${operation.id}: eixo flat inválido.`,
        );
        continue;
      }

      const seedId = adjacentMovingPanelId(args.topology, crease, moving);
      if (!seedId) continue;
      const flatSeedMat = flatMatrices.get(seedId);
      if (!flatSeedMat) continue;
      const flatMovingPoint = new THREE.Vector3(0, 0, 0).applyMatrix4(
        flatSeedMat,
      );

      let axis = hinge.direction.clone();
      if (axis.lengthSq() < 1e-12 || !Number.isFinite(axis.x)) {
        errors.push(`A operação ${operation.id}: eixo de dobra inválido.`);
        continue;
      }
      axis.normalize();

      // Polaridade do eixo mundano alinhada ao flat para o sinal continuar válido.
      const flatAxis = flatHinge.direction.clone().normalize();
      if (axis.dot(flatAxis) < 0) {
        axis.negate();
      }

      if (
        !Number.isFinite(hinge.point.x) ||
        !Number.isFinite(hinge.point.y) ||
        !Number.isFinite(hinge.point.z)
      ) {
        errors.push(`A operação ${operation.id}: ponto de vinco inválido.`);
        continue;
      }

      const sign = resolveRotationSign(
        flatHinge.point,
        flatAxis,
        flatMovingPoint,
        frontNormal,
        operation.towards,
      );

      const targetDeg =
        args.angleOverride?.get(operation.id) ?? operation.targetAngleDeg;
      const angle = closedAngleRad(targetDeg, sign, open01);
      if (!Number.isFinite(angle)) {
        errors.push(`A operação ${operation.id}: ângulo inválido.`);
        continue;
      }

      const layer = stackLayerIndex(
        args.operations,
        operation,
        args.progressByOp,
        args.resolveMoving,
        allPanelIds,
      );
      const stackAmt = thickness * layer * (1 - open01);
      const stackDir =
        operation.towards === "front"
          ? frontNormal.clone()
          : frontNormal.clone().negate();

      const hingePoint = hinge.point
        .clone()
        .addScaledVector(stackDir, stackAmt);
      const rotation = makeRotationAroundLine(hingePoint, axis, angle);

      for (const panelId of moving) {
        const current = before.get(panelId)!;
        const next = rotation.clone().multiply(current);
        if (!matrixIsFinite(next)) {
          errors.push(`A operação ${operation.id}: matriz NaN em ${panelId}.`);
          continue;
        }
        matrices.set(panelId, next);
      }
    }
  }

  return { matrices, errors };
}

export function matrixIsFinite(m: THREE.Matrix4): boolean {
  const e = m.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i]!)) return false;
  }
  return true;
}

/** True se a matriz é só translação (painel miolo parado). */
export function matrixIsTranslationOnly(m: THREE.Matrix4, eps = 1e-5): boolean {
  const e = m.elements;
  // column-major: rotation part near identity
  const r00 = e[0]!,
    r01 = e[4]!,
    r02 = e[8]!;
  const r10 = e[1]!,
    r11 = e[5]!,
    r12 = e[9]!;
  const r20 = e[2]!,
    r21 = e[6]!,
    r22 = e[10]!;
  return (
    Math.abs(r00 - 1) < eps &&
    Math.abs(r11 - 1) < eps &&
    Math.abs(r22 - 1) < eps &&
    Math.abs(r01) < eps &&
    Math.abs(r02) < eps &&
    Math.abs(r10) < eps &&
    Math.abs(r12) < eps &&
    Math.abs(r20) < eps &&
    Math.abs(r21) < eps
  );
}
