import { quantizeMm, uniqueSortedBreaks } from "./foldNormalization";
import { buildFoldTopology, resolveMovingPanels } from "./foldTopology";
import type {
  FoldCrease,
  FoldOperation,
  FoldSheetDefinition,
  FoldValidationIssue,
} from "./foldTypes";
import { MIN_PANEL_MM } from "./foldTypes";

export function validateFoldDefinition(
  def: FoldSheetDefinition,
): FoldValidationIssue[] {
  const issues: FoldValidationIssue[] = [];
  const ids = new Set<string>();

  if (!(def.widthMm > 0) || !(def.heightMm > 0)) {
    issues.push({
      level: "error",
      code: "sheet_size",
      message: "Dimensões da folha inválidas.",
    });
  }


  for (const c of def.creases) {
    if (ids.has(c.id)) {
      issues.push({
        level: "error",
        code: "dup_crease_id",
        message: `Vinco duplicado: ${c.id}`,
      });
    }
    ids.add(c.id);
    const span = c.axis === "vertical" ? def.widthMm : def.heightMm;
    if (c.positionMm <= 0 || c.positionMm >= span) {
      issues.push({
        level: "error",
        code: "crease_bounds",
        message: `Vinco ${c.id} fora da folha.`,
      });
    }
  }

  for (const o of def.operations) {
    if (ids.has(o.id)) {
      issues.push({
        level: "error",
        code: "dup_op_id",
        message: `Operação duplicada: ${o.id}`,
      });
    }
    ids.add(o.id);
    if (!def.creases.some((c) => c.id === o.creaseId)) {
      issues.push({
        level: "error",
        code: "orphan_op",
        message: `Operação ${o.id} referencia vinco inexistente.`,
      });
    }
  }

  issues.push(...validateMinPanelGaps(def.widthMm, def.heightMm, def.creases));

  const topology = buildFoldTopology(def);
  for (const op of def.operations) {
    const moving = resolveMovingPanels(topology, op, def.creases);
    if (moving.size === 0) {
      issues.push({
        level: "error",
        code: "empty_moving",
        message: `Operação ${op.id}: lado móvel sem painéis.`,
      });
    } else if (moving.size >= topology.panels.length) {
      issues.push({
        level: "error",
        code: "moves_all",
        message: `Operação ${op.id}: movimentaria a folha inteira.`,
      });
    }
  }

  // Phase conflicts: same phaseId sharing panel ids
  const byPhase = new Map<string, FoldOperation[]>();
  for (const op of def.operations) {
    if (!op.phaseId) continue;
    const list = byPhase.get(op.phaseId) ?? [];
    list.push(op);
    byPhase.set(op.phaseId, list);
  }
  for (const [phase, ops] of byPhase) {
    if (ops.length < 2) continue;
    const used = new Set<string>();
    for (const op of ops) {
      const moving = resolveMovingPanels(topology, op, def.creases);
      for (const id of moving) {
        if (used.has(id)) {
          issues.push({
            level: "error",
            code: "phase_overlap",
            message: `Fase ${phase}: painéis móveis se sobrepõem.`,
          });
          break;
        }
        used.add(id);
      }
    }
  }

  return issues;
}

function validateMinPanelGaps(
  widthMm: number,
  heightMm: number,
  creases: FoldCrease[],
): FoldValidationIssue[] {
  const issues: FoldValidationIssue[] = [];
  const check = (axis: FoldCrease["axis"], span: number) => {
    const cuts = creases
      .filter((c) => c.axis === axis)
      .map((c) => quantizeMm(c.positionMm));
    const breaks = uniqueSortedBreaks(span, cuts);
    for (let i = 0; i < breaks.length - 1; i++) {
      const gap = breaks[i + 1]! - breaks[i]!;
      if (gap + 1e-6 < MIN_PANEL_MM) {
        issues.push({
          level: "error",
          code: "min_panel",
          message: `Painel ${axis} com ${gap.toFixed(1)} mm (mín. ${MIN_PANEL_MM} mm).`,
        });
      }
    }
  };
  check("vertical", widthMm);
  check("horizontal", heightMm);
  return issues;
}

export function hasBlockingErrors(issues: FoldValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
