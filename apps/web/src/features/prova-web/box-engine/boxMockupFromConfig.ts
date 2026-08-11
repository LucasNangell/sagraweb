import type { BoxModelConfig } from "@/api/boxModels";
import type { ProvaWebBoxMockupMeta } from "@/api/provaWeb";

/** Espelha `build_box_mockup_from_model_config` do backend (preview Admin / FE). */
export function boxMockupFromConfig(
  cfg: BoxModelConfig,
): ProvaWebBoxMockupMeta {
  const hingeById = new Map(cfg.hinges.map((h) => [h.id, h]));
  const panels = (cfg.panels ?? [])
    .filter((p) => p.active !== false)
    .map((p) => ({
      id: p.id,
      role: p.role || "panel",
      xMm: p.xMm,
      yMm: p.yMm,
      wMm: p.wMm,
      hMm: p.hMm,
      parentId: null as string | null,
      hinge: null as "left" | "right" | "top" | "bottom" | null,
      bodyAngleDeg: 0,
      flap: p.id !== cfg.basePanelId,
      u0: p.u0 ?? 0,
      v0: p.v0 ?? 0,
      u1: p.u1 ?? 1,
      v1: p.v1 ?? 1,
      label: p.label || p.id,
    }));

  for (const op of [...(cfg.operations ?? [])].sort(
    (a, b) => a.order - b.order,
  )) {
    const h = hingeById.get(op.hingeId);
    if (!h || !op.panelId) continue;
    const other = h.panelA === op.panelId ? h.panelB : h.panelA;
    const panel = panels.find((p) => p.id === op.panelId);
    if (!panel) continue;
    panel.parentId = other;
    panel.hinge = h.axis === "vertical" ? "left" : "bottom";
  }

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
    openOperations: (cfg.operations ?? []).map((o) => ({
      id: o.id,
      panelId: o.panelId,
      hingeId: o.hingeId,
      order: o.order,
      targetAngleDeg: o.targetAngleDeg,
      phaseId: o.phaseId,
      movingSide: o.movingSide,
      towards: o.towards,
    })),
    basePanelId: cfg.basePanelId,
    cutBboxMm: cut as Record<string, number>,
    ready: true,
    paperThicknessMm: 0.4,
  };
}
