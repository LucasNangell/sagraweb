import type {
  ProvaWebBoxMockupMeta,
  ProvaWebBoxPanel,
  ProvaWebCaixaOpenOperation,
} from "@/api/provaWeb";

export type BoxHinge = "left" | "right" | "top" | "bottom";

export interface BoxPanelDef extends ProvaWebBoxPanel {
  hinge: BoxHinge | null;
}

export function panelsById(
  panels: ProvaWebBoxPanel[],
): Map<string, ProvaWebBoxPanel> {
  return new Map(panels.map((p) => [p.id, p]));
}

/**
 * Progresso 0=fechado → 1=aberto: operações por order/phase,
 * com sobreposição suave entre níveis.
 */
export function resolveFlapProgress(
  operations: ProvaWebCaixaOpenOperation[],
  open01: number,
): Map<string, number> {
  const t = Math.max(0, Math.min(1, open01));
  const byOrder = new Map<number, ProvaWebCaixaOpenOperation[]>();
  for (const op of operations) {
    const list = byOrder.get(op.order) ?? [];
    list.push(op);
    byOrder.set(op.order, list);
  }
  const orders = [...byOrder.keys()].sort((a, b) => a - b);
  const n = Math.max(1, orders.length);
  const out = new Map<string, number>();
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i]!;
    const start = i / n;
    const end = (i + 1) / n;
    let local = 0;
    if (t <= start) local = 0;
    else if (t >= end) local = 1;
    else local = (t - start) / (end - start);
    for (const op of byOrder.get(order) ?? []) {
      out.set(op.panelId, local);
    }
  }
  return out;
}

export function flapAngleDeg(
  op: ProvaWebCaixaOpenOperation | undefined,
  open01: number,
): number {
  if (!op) return 0;
  const target = op.targetAngleDeg ?? 0;
  return target * Math.max(0, Math.min(1, open01));
}

export function boxDiagonalMm(meta: ProvaWebBoxMockupMeta): number {
  const d = meta.dimsMm;
  return Math.hypot(d.length, d.width, d.height);
}
