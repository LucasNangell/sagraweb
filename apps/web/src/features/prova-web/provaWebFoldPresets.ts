import type {
  FoldCrease,
  FoldModelConfig,
  FoldOperation,
  FoldPresetId,
  ProvaWebFolhetoCrop,
  CropSidesMm,
} from "@/api/provaWeb";
import { emptyCropSides } from "@/api/provaWeb";

import {
  sheetFromPreset,
  FOLD_PRESET_OPTIONS,
} from "./fold-engine";
import { syncOperationsToBasePanel, buildFoldTopology } from "./fold-engine";
import {
  DEFAULT_ARTWORK_BACK,
  DEFAULT_PHYSICAL,
  type FoldSheetDefinition,
} from "./fold-engine/foldTypes";
import { resolvePhysical, renderThicknessMm } from "./fold-engine/foldStacking";

export { FOLD_PRESET_OPTIONS };
export { sheetFromPreset };

export const FOLD_LINE_COLORS = [
  "#7c3aed",
  "#ea580c",
  "#0d9488",
  "#db2777",
  "#2563eb",
];

const MIN_PANEL_MM = 15;
const MIN_FRAC = 0.02;
const MAX_FRAC = 0.98;

export function usableAfterCrop(
  pageW: number,
  pageH: number,
  crop: { top: number; right: number; bottom: number; left: number },
): { w: number; h: number } {
  return {
    w: Math.max(MIN_PANEL_MM, pageW - crop.left - crop.right),
    h: Math.max(MIN_PANEL_MM, pageH - crop.top - crop.bottom),
  };
}

/** Config legado (dobras sem creases) → deve forçar reconfiguração. */
export function isLegacyFolhetoConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  const hasNew =
    Array.isArray(o.creases) &&
    o.creases.length > 0 &&
    Array.isArray(o.operations) &&
    o.operations.length > 0;
  if (hasNew) return false;
  return Array.isArray(o.dobras) && o.dobras.length > 0;
}

export function clampCreasePosition(
  positionMm: number,
  axis: FoldCrease["axis"],
  usableW: number,
  usableH: number,
  others: FoldCrease[],
): number {
  const span = axis === "vertical" ? usableW : usableH;
  const same = others
    .filter((c) => c.axis === axis)
    .map((c) => c.positionMm)
    .sort((a, b) => a - b);
  let lo = MIN_PANEL_MM;
  let hi = span - MIN_PANEL_MM;
  for (const p of same) {
    if (p < positionMm) lo = Math.max(lo, p + MIN_PANEL_MM);
    if (p > positionMm) hi = Math.min(hi, p - MIN_PANEL_MM);
  }
  if (hi < lo) return Math.round(((lo + hi) / 2) * 100) / 100;
  return Math.round(Math.max(lo, Math.min(hi, positionMm)) * 100) / 100;
}

export function toSheetDefinition(
  folheto: Pick<
    ProvaWebFolhetoCrop,
    "creases" | "operations" | "physical" | "backArtworkTransform"
  >,
  widthMm: number,
  heightMm: number,
): FoldSheetDefinition {
  const physical = resolvePhysical(folheto.physical);
  return {
    widthMm,
    heightMm,
    thicknessMm: renderThicknessMm(physical),
    creases: folheto.creases,
    operations: folheto.operations,
    backArtworkTransform: folheto.backArtworkTransform ?? DEFAULT_ARTWORK_BACK,
    physical,
  };
}

export function defaultFolhetoCrop(
  _pageWidthMm = 210,
  _pageHeightMm = 297,
): ProvaWebFolhetoCrop {
  const crop = emptyCropSides("trimbox");
  return {
    preset: "personalizada",
    crop,
    creases: [],
    operations: [],
    pageFrente: 1,
    pageVerso: 0,
    backArtworkTransform: { ...DEFAULT_ARTWORK_BACK },
    physical: { ...DEFAULT_PHYSICAL },
  };
}

/** Hidrata cropJson.folheto salvo; legado ou inválido → null (wizard recomeça). */
export function hydrateFolhetoFromInitial(
  raw: unknown,
): ProvaWebFolhetoCrop | null {
  if (!raw || typeof raw !== "object") return null;
  if (isLegacyFolhetoConfig(raw)) return null;
  const o = raw as Partial<ProvaWebFolhetoCrop> & Record<string, unknown>;
  if (!Array.isArray(o.creases) || o.creases.length === 0) return null;
  if (!Array.isArray(o.operations) || o.operations.length === 0) return null;
  const base = defaultFolhetoCrop();
  const crop =
    o.crop && typeof o.crop === "object"
      ? {
          top: Number((o.crop as CropSidesMm).top) || 0,
          right: Number((o.crop as CropSidesMm).right) || 0,
          bottom: Number((o.crop as CropSidesMm).bottom) || 0,
          left: Number((o.crop as CropSidesMm).left) || 0,
          source: (o.crop as CropSidesMm).source,
        }
      : base.crop;
  return {
    ...base,
    preset: (o.preset as FoldPresetId) || base.preset,
    crop,
    creases: o.creases as FoldCrease[],
    operations: o.operations as FoldOperation[],
    pageFrente:
      o.pageFrente == null ? base.pageFrente : Math.max(0, Math.floor(Number(o.pageFrente))),
    pageVerso:
      o.pageVerso == null
        ? null
        : Math.max(0, Math.floor(Number(o.pageVerso))),
    panelPages: Array.isArray(o.panelPages) ? o.panelPages : undefined,
    backArtworkTransform: {
      ...(o.backArtworkTransform
        ? { ...DEFAULT_ARTWORK_BACK, ...o.backArtworkTransform }
        : { ...DEFAULT_ARTWORK_BACK }),
      mirrorX: true,
    },
    physical: o.physical
      ? { ...DEFAULT_PHYSICAL, ...o.physical }
      : { ...DEFAULT_PHYSICAL },
    basePanelId: o.basePanelId ?? null,
  };
}

export function applyPresetToFolheto(
  folheto: ProvaWebFolhetoCrop,
  preset: FoldPresetId,
  pageWidthMm: number,
  pageHeightMm: number,
): ProvaWebFolhetoCrop {
  const { w, h } = usableAfterCrop(pageWidthMm, pageHeightMm, folheto.crop);
  const { creases, operations } = sheetFromPreset(preset, w, h);
  return {
    ...folheto,
    preset,
    creases,
    operations,
  };
}

/** Linhas para overlay do crop (só posição/eixo). */
export function creasesAsFoldLines(creases: FoldCrease[]): Array<{
  id: string;
  eixo: "vertical" | "horizontal";
  posicaoMm: number;
}> {
  return creases.map((c) => ({
    id: c.id,
    eixo: c.axis,
    posicaoMm: c.positionMm,
  }));
}

/** Empacota vincos/operações + páginas PDF + duplex para o catálogo. */
export function packFoldModelConfig(
  folheto: Pick<
    ProvaWebFolhetoCrop,
    | "creases"
    | "operations"
    | "pageFrente"
    | "pageVerso"
    | "basePanelId"
    | "physical"
    | "backArtworkTransform"
  >,
  widthMm: number,
  heightMm: number,
): FoldModelConfig {
  const w = Math.max(MIN_PANEL_MM, widthMm);
  const h = Math.max(MIN_PANEL_MM, heightMm);
  const pageFrente = Math.max(0, Math.floor(folheto.pageFrente ?? 1));
  const pageVerso =
    folheto.pageVerso == null
      ? null
      : Math.max(0, Math.floor(folheto.pageVerso));
  return {
    version: 1,
    creases: folheto.creases.map((c) => {
      const span = c.axis === "vertical" ? w : h;
      const frac = Math.min(
        MAX_FRAC,
        Math.max(MIN_FRAC, span > 0 ? c.positionMm / span : 0.5),
      );
      return {
        id: c.id,
        axis: c.axis,
        positionFrac: Math.round(frac * 1e6) / 1e6,
      };
    }),
    operations: folheto.operations.map((o) => {
      const base = {
        id: o.id,
        creaseId: o.creaseId,
        order: o.order,
        movingSide: o.movingSide,
        towards: o.towards,
        targetAngleDeg: o.targetAngleDeg,
        ...(o.phaseId ? { phaseId: o.phaseId } : {}),
      };
      const stagger = o.startAfterPrevOpen01;
      if (
        stagger != null &&
        Number.isFinite(stagger) &&
        Math.abs(stagger - 1) > 1e-6
      ) {
        return {
          ...base,
          startAfterPrevOpen01: Math.min(1, Math.max(0, stagger)),
        };
      }
      return base;
    }),
    pageFrente,
    pageVerso,
    basePanelId: folheto.basePanelId ?? null,
    ...(folheto.physical ? { physical: { ...folheto.physical } } : {}),
    backArtworkTransform: {
      ...(folheto.backArtworkTransform ?? DEFAULT_ARTWORK_BACK),
      mirrorX: true,
    },
  };
}

/** Aplica um modelo salvo (geometria + páginas PDF + duplex). */
export function applyFoldModelConfig(
  folheto: ProvaWebFolhetoCrop,
  config: FoldModelConfig,
  widthMm: number,
  heightMm: number,
  opts?: { pageCount?: number },
): ProvaWebFolhetoCrop {
  const w = Math.max(MIN_PANEL_MM, widthMm);
  const h = Math.max(MIN_PANEL_MM, heightMm);
  const pageCount = Math.max(1, opts?.pageCount ?? 1);
  const creases: FoldCrease[] = (config.creases ?? []).map((c) => {
    const span = c.axis === "vertical" ? w : h;
    const frac = Math.min(
      MAX_FRAC,
      Math.max(MIN_FRAC, Number(c.positionFrac) || 0.5),
    );
    return {
      id: c.id,
      axis: c.axis,
      positionMm: Math.round(span * frac * 100) / 100,
    };
  });

  const pageFrente = Math.max(
    0,
    Math.min(
      pageCount - 1,
      Math.floor(
        config.pageFrente != null ? config.pageFrente : (folheto.pageFrente ?? 1),
      ),
    ),
  );

  let pageVerso: number | null = folheto.pageVerso;
  if (Object.prototype.hasOwnProperty.call(config, "pageVerso")) {
    pageVerso =
      config.pageVerso == null || pageCount < 2
        ? null
        : Math.max(
            0,
            Math.min(pageCount - 1, Math.floor(config.pageVerso)),
          );
  } else if (pageCount < 2) {
    pageVerso = null;
  }

  let operations = (config.operations ?? []).map((o) => {
    const stagger = o.startAfterPrevOpen01;
    return {
      id: o.id,
      creaseId: o.creaseId,
      order: o.order,
      movingSide: o.movingSide,
      towards: o.towards,
      targetAngleDeg: o.targetAngleDeg,
      ...(o.phaseId ? { phaseId: o.phaseId } : {}),
      ...(stagger != null &&
      Number.isFinite(stagger) &&
      Math.abs(stagger - 1) > 1e-6
        ? {
            startAfterPrevOpen01: Math.min(1, Math.max(0, Number(stagger))),
          }
        : {}),
    };
  });
  const basePanelId = Object.prototype.hasOwnProperty.call(config, "basePanelId")
    ? (config.basePanelId ?? null)
    : (folheto.basePanelId ?? null);
  if (basePanelId && creases.length > 0 && operations.length > 0) {
    const def = toSheetDefinition(
      {
        creases,
        operations,
        physical: folheto.physical,
        backArtworkTransform: folheto.backArtworkTransform,
      },
      w,
      h,
    );
    operations = syncOperationsToBasePanel(
      buildFoldTopology(def),
      creases,
      operations,
      basePanelId,
    );
  }

  return {
    ...folheto,
    preset: "personalizada",
    creases,
    operations,
    pageFrente,
    pageVerso,
    ...(Object.prototype.hasOwnProperty.call(config, "basePanelId")
      ? { basePanelId: config.basePanelId ?? null }
      : {}),
    ...(config.physical
      ? { physical: { ...folheto.physical, ...config.physical } }
      : {}),
    ...(config.backArtworkTransform
      ? {
          backArtworkTransform: {
            ...config.backArtworkTransform,
            mirrorX: true,
          },
        }
      : {
          backArtworkTransform: {
            ...(folheto.backArtworkTransform ?? DEFAULT_ARTWORK_BACK),
            mirrorX: true,
          },
        }),
  };
}
