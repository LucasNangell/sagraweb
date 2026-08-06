import type { CSSProperties } from "react";

import { FOLD_LINE_COLORS } from "./provaWebFoldPresets";
import { duplexBackBandMm, duplexMirrorPositionMm } from "./fold-engine/foldDuplex";
import { resolveMovingPanels } from "./fold-engine/foldTopology";
import type {
  FoldCrease,
  FoldOperation,
  FoldTopology,
} from "./fold-engine/foldTypes";

export type FoldArrowGeom = {
  opId: string;
  order: number;
  orderLabel: string;
  creaseId: string;
  axis: FoldCrease["axis"];
  /** Posição do vinco no espaço geométrico da frente (mm). */
  creasePosMm: number;
  /** Posição desenhada na face (verso duplex pode espelhar). */
  drawCreasePosMm: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  towards: FoldOperation["towards"];
  selected: boolean;
  color: string;
};

function orderLabel(order: number): string {
  return `${order}ª`;
}

/**
 * Setas do painel móvel → estacionário.
 * Vertical negative: esquerda → direita; positive: direita → esquerda.
 */
export function buildFoldArrowGeoms(args: {
  topology: FoldTopology;
  creases: FoldCrease[];
  operations: FoldOperation[];
  selectedOpId: string | null;
  /** Desenho no verso com duplex: espelha a abscissa do vinco. */
  mirrorVerticalCreases?: boolean;
}): FoldArrowGeom[] {
  const {
    topology,
    creases,
    operations,
    selectedOpId,
    mirrorVerticalCreases = false,
  } = args;
  const W = topology.widthMm;
  const H = topology.heightMm;
  const sorted = [...operations].sort((a, b) => a.order - b.order);

  return sorted.flatMap((op, opIndex) => {
    const crease = creases.find((c) => c.id === op.creaseId);
    if (!crease) return [];
    const moving = resolveMovingPanels(topology, op, creases);
    if (moving.size === 0) return [];

    const movingPanels = topology.panels.filter((p) => moving.has(p.id));
    if (movingPanels.length === 0) return [];

    const color = FOLD_LINE_COLORS[opIndex % FOLD_LINE_COLORS.length]!;
    const stack = Math.floor(opIndex / 2) * 6 + (opIndex % 2) * 10;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    let drawCreasePosMm = crease.positionMm;

    if (crease.axis === "vertical") {
      if (mirrorVerticalCreases) {
        drawCreasePosMm = duplexMirrorPositionMm(crease.positionMm, W);
      }
      const midY =
        movingPanels.reduce(
          (s, p) => s + p.yMm + p.heightMm / 2,
          0,
        ) / movingPanels.length;
      const y = Math.min(H - 8, Math.max(8, midY + (opIndex % 3) * 4 - 4));
      const tip = Math.min(28, Math.max(14, W * 0.08));
      if (op.movingSide === "negative") {
        // Aba esquerda dobra para a direita (sobre o miolo)
        x1 = drawCreasePosMm - tip - stack * 0.15;
        x2 = drawCreasePosMm + tip * 0.35;
      } else {
        x1 = drawCreasePosMm + tip + stack * 0.15;
        x2 = drawCreasePosMm - tip * 0.35;
      }
      y1 = y;
      y2 = y;
    } else {
      const midX =
        movingPanels.reduce((s, p) => s + p.xMm + p.widthMm / 2, 0) /
        movingPanels.length;
      const x = Math.min(W - 8, Math.max(8, midX + (opIndex % 3) * 4 - 4));
      const tip = Math.min(28, Math.max(14, H * 0.08));
      if (op.movingSide === "negative") {
        y1 = crease.positionMm - tip - stack * 0.15;
        y2 = crease.positionMm + tip * 0.35;
      } else {
        y1 = crease.positionMm + tip + stack * 0.15;
        y2 = crease.positionMm - tip * 0.35;
      }
      x1 = x;
      x2 = x;
      drawCreasePosMm = crease.positionMm;
    }

    return [
      {
        opId: op.id,
        order: op.order,
        orderLabel: orderLabel(op.order),
        creaseId: crease.id,
        axis: crease.axis,
        creasePosMm: crease.positionMm,
        drawCreasePosMm,
        x1,
        y1,
        x2,
        y2,
        towards: op.towards,
        selected: selectedOpId === op.id,
        color,
      },
    ];
  });
}

/** Posição/tamanho CSS da arte do PDF em um retângulo de painel. */
export function panelArtBackgroundStyle(args: {
  panelXMm: number;
  panelYMm: number;
  panelWidthMm: number;
  panelHeightMm: number;
  usableW: number;
  usableH: number;
  duplexTurn?: boolean;
  face: "front" | "back";
  dataUrl: string | null;
}): CSSProperties {
  const {
    panelXMm,
    panelYMm,
    panelWidthMm,
    panelHeightMm,
    usableW,
    usableH,
    duplexTurn = false,
    face,
    dataUrl,
  } = args;

  if (!dataUrl || panelWidthMm <= 0 || panelHeightMm <= 0) {
    return { backgroundColor: "#e2e8f0" };
  }

  const band =
    face === "back"
      ? duplexBackBandMm(panelXMm, panelWidthMm, usableW, duplexTurn)
      : {
          u0: panelXMm / Math.max(1e-6, usableW),
          u1: (panelXMm + panelWidthMm) / Math.max(1e-6, usableW),
          bandWidthMm: panelWidthMm,
        };

  const sizeX = (usableW / panelWidthMm) * 100;
  const sizeY = (usableH / panelHeightMm) * 100;
  const posX = -(band.u0 * usableW) / panelWidthMm * 100;
  const posY = -(panelYMm / panelHeightMm) * 100;

  return {
    backgroundImage: `url(${dataUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${sizeX}% ${sizeY}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}
