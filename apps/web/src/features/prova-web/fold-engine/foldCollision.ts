import * as THREE from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";

import type { PanelMatrixMap } from "./foldKinematics";
import {
  evaluateFoldState,
  type PanelMatrixMap,
} from "./foldKinematics";
import type { FoldCrease, FoldOperation, FoldTopology } from "./foldTypes";

export function findMaximumSafeAngle(
  safeAngle: number,
  desiredAngle: number,
  collidesAt: (angle: number) => boolean,
): number {
  let safe = safeAngle;
  let blocked = desiredAngle;
  for (let i = 0; i < 12; i++) {
    const middle = (safe + blocked) / 2;
    if (collidesAt(middle)) blocked = middle;
    else safe = middle;
  }
  return safe;
}

function panelOBB(
  topology: FoldTopology,
  panelId: string,
  matrices: PanelMatrixMap,
  thickness: number,
): OBB | null {
  const p = topology.panels.find((x) => x.id === panelId);
  const m = matrices.get(panelId);
  if (!p || !m) return null;
  const obb = new OBB(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(p.widthMm / 2, p.heightMm / 2, thickness / 2),
    new THREE.Matrix3(),
  );
  obb.applyMatrix4(m);
  return obb;
}

export function panelsCollide(
  topology: FoldTopology,
  matrices: PanelMatrixMap,
  moving: Set<string>,
  stationary: string[],
  thickness: number,
  excludePairs?: Set<string>,
): boolean {
  for (const mid of moving) {
    const a = panelOBB(topology, mid, matrices, thickness);
    if (!a) continue;
    for (const sid of stationary) {
      const key = mid < sid ? `${mid}|${sid}` : `${sid}|${mid}`;
      if (excludePairs?.has(key)) continue;
      const b = panelOBB(topology, sid, matrices, thickness);
      if (!b) continue;
      if (a.intersectsOBB(b)) return true;
    }
  }
  return false;
}

/** Pares adjacentes pelo vinco ativo são excluídos do teste de colisão. */
export function creaseContactPairs(
  topology: FoldTopology,
  creaseId: string,
): Set<string> {
  const out = new Set<string>();
  for (const eid of topology.edgesByCrease.get(creaseId) ?? []) {
    const e = topology.edges.find((x) => x.id === eid);
    if (!e) continue;
    const key =
      e.panelAId < e.panelBId
        ? `${e.panelAId}|${e.panelBId}`
        : `${e.panelBId}|${e.panelAId}`;
    out.add(key);
  }
  return out;
}

/**
 * Abas já fechadas (mesmo towards) — penetração é empilhamento esperado.
 */
function previouslyFoldedFlapPairs(
  operations: FoldOperation[],
  current: FoldOperation,
  progressByOp: Map<string, number>,
  resolveMoving: (op: FoldOperation, priorMatrices?: PanelMatrixMap) => Set<string>,
  currentMoving: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const prev of operations) {
    if (prev.id === current.id) continue;
    if (prev.order >= current.order) continue;
    if (prev.towards !== current.towards) continue;
    const open01 = progressByOp.get(prev.id) ?? 1;
    if (open01 >= 0.999) continue;
    const prevMoving = resolveMoving(prev);
    for (const mid of currentMoving) {
      for (const pid of prevMoving) {
        const key = mid < pid ? `${mid}|${pid}` : `${pid}|${mid}`;
        out.add(key);
      }
    }
  }
  return out;
}

/**
 * Para cada operação fechando, limita o ângulo alvo se houver penetração.
 * Não zera o fecho da 2ª aba de carteira (empilhamento esperado).
 */
export function computeSafeAngleOverrides(args: {
  topology: FoldTopology;
  creases: FoldCrease[];
  operations: FoldOperation[];
  progressByOp: Map<string, number>;
  resolveMoving: (op: FoldOperation, priorMatrices?: PanelMatrixMap) => Set<string>;
  thickness: number;
}): Map<string, number> {
  const overrides = new Map<string, number>();

  for (const op of args.operations) {
    const open01 = args.progressByOp.get(op.id) ?? 1;
    if (open01 >= 1 - 1e-9) continue;

    const moving = args.resolveMoving(op);
    if (moving.size === 0) continue;
    const stationary = args.topology.panels
      .map((p) => p.id)
      .filter((id) => !moving.has(id));
    const exclude = creaseContactPairs(args.topology, op.creaseId);
    for (const k of previouslyFoldedFlapPairs(
      args.operations,
      op,
      args.progressByOp,
      args.resolveMoving,
      moving,
    )) {
      exclude.add(k);
    }

    const collidesAt = (targetDeg: number) => {
      const angleOverride = new Map(overrides);
      angleOverride.set(op.id, targetDeg);
      const { matrices } = evaluateFoldState({
        topology: args.topology,
        creases: args.creases,
        operations: args.operations,
        progressByOp: args.progressByOp,
        resolveMoving: args.resolveMoving,
        angleOverride,
        thicknessMm: args.thickness,
      });
      return panelsCollide(
        args.topology,
        matrices,
        moving,
        stationary,
        args.thickness,
        exclude,
      );
    };

    if (!collidesAt(op.targetAngleDeg)) continue;
    const safe = findMaximumSafeAngle(0, op.targetAngleDeg, collidesAt);
    // Preferir empilhamento + ângulo alvo a abrir a aba (carteira 2ª dobra).
    if (safe < op.targetAngleDeg * 0.85) continue;
    overrides.set(op.id, safe);
  }

  return overrides;
}
