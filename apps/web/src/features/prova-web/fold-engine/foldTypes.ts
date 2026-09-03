/** Tipos puros do motor de dobra (sem Three.js). */

export type FoldAxis = "vertical" | "horizontal";
export type FoldMovingSide = "negative" | "positive";
export type FoldTowards = "front" | "back";

export interface FoldCrease {
  id: string;
  axis: FoldAxis;
  positionMm: number;
  spanStartMm?: number;
  spanEndMm?: number;
}

export interface FoldOperation {
  id: string;
  creaseId: string;
  order: number;
  movingSide: FoldMovingSide;
  towards: FoldTowards;
  targetAngleDeg: number;
  phaseId?: string;
  /** 0–1; default 1 = espera anterior 100% aberta. */
  startAfterPrevOpen01?: number;
}

export interface FoldPanelTopology {
  id: string;
  row: number;
  column: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  centerMm: { x: number; y: number };
}

export interface FoldAdjacencyEdge {
  id: string;
  panelAId: string;
  panelBId: string;
  creaseId: string;
  localSegment: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
}

export interface FoldTopology {
  widthMm: number;
  heightMm: number;
  panels: FoldPanelTopology[];
  edges: FoldAdjacencyEdge[];
  /** creaseId → edge ids */
  edgesByCrease: Map<string, string[]>;
}

export interface FoldPanelPageAssignment {
  panelId: string;
  frontPage: number | null;
  backPage: number | null;
  frontRotationDeg?: 0 | 90 | 180 | 270;
  backRotationDeg?: 0 | 90 | 180 | 270;
}

export interface ArtworkTransform {
  mirrorX: boolean;
  mirrorY: boolean;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface FoldPhysicalProperties {
  paperThicknessMm: number;
  renderGapMm: number;
  creaseRadiusMm: number;
}

export const DEFAULT_PHYSICAL: FoldPhysicalProperties = {
  paperThicknessMm: 0.028,
  renderGapMm: 0.002,
  creaseRadiusMm: 0.08,
};

export interface FoldSheetDefinition {
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  creases: FoldCrease[];
  operations: FoldOperation[];
  backArtworkTransform: ArtworkTransform;
  physical: FoldPhysicalProperties;
}

export interface FoldValidationIssue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

export const POSITION_EPSILON_MM = 0.01;
export const MIN_PANEL_MM = 15;
export const AXIS_PARALLEL_EPSILON = 1e-5;
export const AXIS_DISTANCE_EPSILON_MM = 0.05;

export const DEFAULT_ARTWORK_BACK: ArtworkTransform = {
  /**
   * Duplex “turn” (virar na borda longa): remapeia UVs do verso L↔R
   * (painel esquerdo amostra a faixa direita do PDF), sem espelhar o texto.
   */
  mirrorX: true,
  mirrorY: false,
  rotationDeg: 0,
};
