import type { BoxModelConfig } from "@/api/boxModels";
import type { ProvaWebBoxMockupMeta } from "@/api/provaWeb";

import {
  buildParentMapFromBase,
  movingPanelForHinge,
} from "./boxPanelTree";

/** Espelha `build_box_mockup_from_model_config` do backend (preview Admin / FE). */
export function boxMockupFromConfig(
  cfg: BoxModelConfig,
): ProvaWebBoxMockupMeta {
  const baseId = cfg.basePanelId;
  const parentMap = buildParentMapFromBase(baseId, cfg.hinges ?? []);
  const hingeById = new Map((cfg.hinges ?? []).map((h) => [h.id, h]));

  const panels = (cfg.panels ?? [])
    .filter((p) => p.active !== false)
    .map((p) => {
      const parentId = parentMap.get(p.id) ?? null;
      const hinge = parentId
        ? (cfg.hinges ?? []).find(
            (h) =>
              (h.panelA === p.id && h.panelB === parentId) ||
              (h.panelB === p.id && h.panelA === parentId),
          )
        : undefined;
      return {
        id: p.id,
        role: p.role || "panel",
        xMm: p.xMm,
        yMm: p.yMm,
        wMm: p.wMm,
        hMm: p.hMm,
        parentId,
        hinge: (hinge?.axis === "vertical"
          ? "left"
          : hinge
            ? "bottom"
            : null) as "left" | "right" | "top" | "bottom" | null,
        bodyAngleDeg: 0,
        flap: p.id !== baseId,
        u0: p.u0 ?? 0,
        v0: p.v0 ?? 0,
        u1: p.u1 ?? 1,
        v1: p.v1 ?? 1,
        label: p.label || p.id,
        polygonMm: p.polygonMm,
      };
    });

  const openOperations = (cfg.operations ?? []).map((o) => {
    const h = hingeById.get(o.hingeId);
    const panelId = h
      ? movingPanelForHinge(h, parentMap, baseId)
      : o.panelId;
    return {
      id: o.id,
      panelId,
      hingeId: o.hingeId,
      order: o.order,
      targetAngleDeg: o.targetAngleDeg,
      phaseId: o.phaseId,
      movingSide: o.movingSide,
      towards: o.towards,
    };
  });

  const cut = cfg.cutBboxMm;
  const hint = cfg.dimsHint as
    | { heightMm?: number; lengthMm?: number; widthMm?: number; glueMm?: number }
    | undefined;

  return {
    template: "graph",
    source: "box_model",
    dimsMm: {
      length: Number(hint?.lengthMm ?? cut?.widthMm ?? cfg.pageWidthMm ?? 100),
      width: Number(hint?.widthMm ?? cut?.heightMm ?? cfg.pageHeightMm ?? 100),
      height: Number(hint?.heightMm ?? 40),
      glue: Number(hint?.glueMm ?? 20),
    },
    netWidthMm: Number(cut?.widthMm ?? 100),
    netHeightMm: Number(cut?.heightMm ?? 100),
    panels,
    hinges: cfg.hinges ?? [],
    openOperations,
    basePanelId: cfg.basePanelId,
    cutBboxMm: cut as Record<string, number>,
    ready: true,
    paperThicknessMm: 0.4,
  };
}
