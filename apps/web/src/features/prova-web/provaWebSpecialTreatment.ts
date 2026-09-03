import type {
  FoldCrease,
  FoldModelConfig,
  FoldOperation,
  FoldPresetId,
  ProvaWebBookExtraFoldLine,
  ProvaWebBookStructureInsert,
  ProvaWebFoldMockupMeta,
} from "@/api/provaWeb";

import { DEFAULT_ARTWORK_BACK, DEFAULT_PHYSICAL } from "./fold-engine/foldTypes";
import { buildFoldTopology } from "./fold-engine/foldTopology";
import { applyFoldModelConfig, defaultFolhetoCrop } from "./provaWebFoldPresets";

export function resolvedSpecialFoldLines(
  treatment: ProvaWebBookStructureInsert,
): ProvaWebBookExtraFoldLine[] {
  const explicit = sanitizeFoldLines(treatment.foldLines, treatment);
  if (explicit.length > 0) return explicit;

  if (treatment.kind === "custom-fold" && treatment.foldConfig) {
    const applied = applyFoldModelConfig(
      defaultFolhetoCrop(treatment.widthMm, treatment.heightMm),
      treatment.foldConfig,
      treatment.widthMm,
      treatment.heightMm,
    );
    return applied.creases.map((c) => ({
      axis: c.axis,
      positionMm: roundMm(c.positionMm),
    }));
  }

  if (treatment.kind === "gatefold") {
    return [
      { axis: "vertical", positionMm: roundMm(treatment.widthMm / 4) },
      { axis: "vertical", positionMm: roundMm((treatment.widthMm * 3) / 4) },
    ];
  }
  if (treatment.kind === "zfold") {
    return [
      { axis: "vertical", positionMm: roundMm(treatment.widthMm / 3) },
      { axis: "vertical", positionMm: roundMm((treatment.widthMm * 2) / 3) },
    ];
  }
  if (treatment.kind === "foldout") {
    const closedWidth = Number(treatment.closedWidthMm);
    const position =
      Number.isFinite(closedWidth) &&
      closedWidth > 0 &&
      closedWidth < treatment.widthMm
        ? closedWidth
        : treatment.widthMm / 2;
    return [{ axis: "vertical", positionMm: roundMm(position) }];
  }
  return [];
}

export function specialTreatmentScale(treatment: ProvaWebBookStructureInsert) {
  const width = Math.max(1, Number(treatment.widthMm) || 1);
  const height = Math.max(1, Number(treatment.heightMm) || 1);
  const ratio = width / height;
  const previewWidth = Math.min(360, Math.max(180, 190 * ratio));
  const previewHeight = Math.min(250, Math.max(110, previewWidth / ratio));
  return { width, height, ratio, previewWidth, previewHeight };
}

export function specialTreatmentPagePixels({
  treatment,
  basePixelSize,
  basePageMm,
}: {
  treatment: ProvaWebBookStructureInsert;
  basePixelSize: { width: number; height: number };
  basePageMm: { widthMm: number; heightMm: number };
}) {
  const baseWidthMm = Math.max(1, Number(basePageMm.widthMm) || 1);
  const baseHeightMm = Math.max(1, Number(basePageMm.heightMm) || 1);
  const widthRatio = Math.max(0.05, treatment.widthMm / baseWidthMm);
  const heightRatio = Math.max(0.05, treatment.heightMm / baseHeightMm);
  return {
    width: basePixelSize.width * widthRatio,
    height: basePixelSize.height * heightRatio,
    widthRatio,
    heightRatio,
  };
}

const FOLD_MOCKUP_KINDS = new Set([
  "foldout",
  "gatefold",
  "zfold",
  "custom-fold",
]);

export function foldMockupFromSpecialTreatment(
  treatment: ProvaWebBookStructureInsert,
): ProvaWebFoldMockupMeta | null {
  if (!FOLD_MOCKUP_KINDS.has(treatment.kind)) return null;

  const widthMm = Math.max(1, Number(treatment.widthMm) || 1);
  const heightMm = Math.max(1, Number(treatment.heightMm) || 1);
  const hasVerso = Boolean(treatment.hasVerso);

  const fromConfig = mockupFromFoldConfig(treatment.foldConfig, widthMm, heightMm, hasVerso);
  if (fromConfig) return fromConfig;

  const lines = resolvedSpecialFoldLines(treatment);
  if (!lines.length) return null;

  const sorted = [...lines].sort((a, b) => {
    if (a.axis !== b.axis) return a.axis === "vertical" ? -1 : 1;
    return a.positionMm - b.positionMm;
  });
  const creases: FoldCrease[] = sorted.map((line, index) => ({
    id: `c${index + 1}`,
    axis: line.axis,
    positionMm: line.positionMm,
  }));

  const mapped = mapSpecialFoldOperations(treatment.kind, creases);
  if (!mapped) return null;

  return buildMockupMeta({
    preset: mapped.preset,
    widthMm,
    heightMm,
    creases,
    operations: mapped.operations,
    hasVerso,
  });
}

function mockupFromFoldConfig(
  foldConfig: FoldModelConfig | null | undefined,
  widthMm: number,
  heightMm: number,
  hasVerso: boolean,
): ProvaWebFoldMockupMeta | null {
  if (!foldConfig?.creases?.length || !foldConfig.operations?.length) {
    return null;
  }
  const applied = applyFoldModelConfig(
    defaultFolhetoCrop(widthMm, heightMm),
    foldConfig,
    widthMm,
    heightMm,
  );
  if (!applied.creases.length || !applied.operations.length) return null;
  return buildMockupMeta({
    preset: "personalizada",
    widthMm,
    heightMm,
    creases: applied.creases,
    operations: applied.operations,
    hasVerso,
    backArtworkTransform: applied.backArtworkTransform ?? DEFAULT_ARTWORK_BACK,
  });
}

function buildMockupMeta(args: {
  preset: FoldPresetId | string;
  widthMm: number;
  heightMm: number;
  creases: FoldCrease[];
  operations: FoldOperation[];
  hasVerso: boolean;
  backArtworkTransform?: ProvaWebFoldMockupMeta["backArtworkTransform"];
}): ProvaWebFoldMockupMeta | null {
  const topology = buildFoldTopology({
    widthMm: args.widthMm,
    heightMm: args.heightMm,
    thicknessMm: DEFAULT_PHYSICAL.paperThicknessMm,
    creases: args.creases,
    operations: args.operations,
    backArtworkTransform: args.backArtworkTransform ?? {
      mirrorX: false,
      mirrorY: false,
      rotationDeg: 0,
    },
    physical: DEFAULT_PHYSICAL,
  });
  if (topology.panels.length < 2) return null;

  return {
    preset: args.preset,
    pageWidthMm: Math.round(args.widthMm * 100) / 100,
    pageHeightMm: Math.round(args.heightMm * 100) / 100,
    panels: topology.panels.map((panel) => ({
      id: panel.id,
      row: panel.row,
      column: panel.column,
      xMm: panel.xMm,
      yMm: panel.yMm,
      wMm: panel.widthMm,
      hMm: panel.heightMm,
    })),
    creases: args.creases,
    operations: args.operations,
    hasVerso: args.hasVerso,
    backArtworkTransform: args.backArtworkTransform,
    physical: DEFAULT_PHYSICAL,
    ready: true,
  };
}

function mapSpecialFoldOperations(
  kind: ProvaWebBookStructureInsert["kind"],
  creases: FoldCrease[],
): { preset: FoldPresetId; operations: FoldOperation[] } | null {
  const axes = new Set(creases.map((c) => c.axis));
  const uniformAxis = axes.size === 1 ? creases[0]!.axis : null;
  const horizontal = uniformAxis === "horizontal";

  if (
    (kind === "foldout" || kind === "custom-fold") &&
    creases.length === 1 &&
    uniformAxis
  ) {
    return {
      preset: horizontal ? "biparte_horizontal" : "biparte_vertical",
      operations: [op("o1", creases[0]!.id, 1, "positive", "front")],
    };
  }
  if (kind === "gatefold" && creases.length === 2 && uniformAxis) {
    return {
      preset: "portao",
      operations: [
        op("o1", creases[0]!.id, 1, "negative", "front", "gate"),
        op("o2", creases[1]!.id, 1, "positive", "front", "gate"),
      ],
    };
  }
  if (kind === "zfold" && creases.length === 2 && uniformAxis) {
    return {
      preset: horizontal
        ? "triptico_sanfona_horizontal"
        : "triptico_sanfona_vertical",
      operations: [
        op("o1", creases[0]!.id, 1, "negative", "front"),
        op("o2", creases[1]!.id, 2, "positive", "back"),
      ],
    };
  }

  if (creases.length === 1 && uniformAxis) {
    return {
      preset: horizontal ? "biparte_horizontal" : "biparte_vertical",
      operations: [op("o1", creases[0]!.id, 1, "positive", "front")],
    };
  }
  if (creases.length === 2 && uniformAxis) {
    return {
      preset: horizontal
        ? "triptico_sanfona_horizontal"
        : "triptico_sanfona_vertical",
      operations: [
        op("o1", creases[0]!.id, 1, "negative", "front"),
        op("o2", creases[1]!.id, 2, "positive", "back"),
      ],
    };
  }
  if (creases.length === 2 && axes.has("vertical") && axes.has("horizontal")) {
    const vertical = creases.find((c) => c.axis === "vertical")!;
    const horiz = creases.find((c) => c.axis === "horizontal")!;
    return {
      preset: "cruzado_v_primeiro",
      operations: [
        op("o1", vertical.id, 1, "positive", "front"),
        op("o2", horiz.id, 2, "positive", "front"),
      ],
    };
  }
  if (creases.length === 3 && uniformAxis) {
    return {
      preset: "sanfona_4",
      operations: [
        op("o1", creases[0]!.id, 1, "negative", "front"),
        op("o2", creases[1]!.id, 2, "positive", "back"),
        op("o3", creases[2]!.id, 3, "negative", "front"),
      ],
    };
  }
  return null;
}

function op(
  id: string,
  creaseId: string,
  order: number,
  movingSide: FoldOperation["movingSide"],
  towards: FoldOperation["towards"],
  phaseId?: string,
  targetAngleDeg = 180,
): FoldOperation {
  return {
    id,
    creaseId,
    order,
    movingSide,
    towards,
    targetAngleDeg,
    ...(phaseId ? { phaseId } : {}),
  };
}

export function verticalFoldPanels(treatment: ProvaWebBookStructureInsert) {
  const verticalLines = resolvedSpecialFoldLines(treatment)
    .filter((line) => line.axis === "vertical")
    .map((line) => line.positionMm)
    .sort((a, b) => a - b);
  if (!verticalLines.length) return [];

  const width = Math.max(1, treatment.widthMm);
  const points = [0, ...verticalLines, width];
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1] ?? width;
    return {
      index,
      leftPct: (start / width) * 100,
      widthPct: ((end - start) / width) * 100,
    };
  });
}

function sanitizeFoldLines(
  lines: ProvaWebBookExtraFoldLine[] | undefined,
  treatment: ProvaWebBookStructureInsert,
): ProvaWebBookExtraFoldLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      axis: line.axis,
      positionMm: roundMm(Number(line.positionMm)),
    }))
    .filter((line) => {
      const limit = line.axis === "vertical" ? treatment.widthMm : treatment.heightMm;
      return line.positionMm > 0 && line.positionMm < limit;
    });
}

function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}
