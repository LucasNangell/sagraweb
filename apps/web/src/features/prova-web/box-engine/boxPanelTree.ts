import type { BoxModelConfig, BoxModelHinge, BoxModelOperation } from "@/api/boxModels";

/** Grafo de adjacência painel→vizinhos via hinges. */
export function hingeAdjacency(
  hinges: BoxModelHinge[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    adj.set(a, list);
  };
  for (const h of hinges) {
    if (!h.panelA || !h.panelB || h.panelA === h.panelB) continue;
    link(h.panelA, h.panelB);
    link(h.panelB, h.panelA);
  }
  return adj;
}

/**
 * Árvore enraizada na base: child → parent (caminho até a base).
 * Só hinges — não usa operations (evita quebrar ao trocar a base).
 */
export function buildParentMapFromBase(
  baseId: string | null | undefined,
  hinges: BoxModelHinge[],
): Map<string, string> {
  const parent = new Map<string, string>();
  if (!baseId) return parent;
  const adj = hingeAdjacency(hinges);
  if (!adj.has(baseId) && !(hinges ?? []).length) return parent;
  const seen = new Set<string>([baseId]);
  const queue = [baseId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      parent.set(nb, cur);
      queue.push(nb);
    }
  }
  return parent;
}

/** Painel que se move na dobra: o filho na árvore (longe da base). */
export function movingPanelForHinge(
  hinge: BoxModelHinge,
  parentMap: Map<string, string>,
  baseId: string | null | undefined,
): string {
  if (parentMap.get(hinge.panelA) === hinge.panelB) return hinge.panelA;
  if (parentMap.get(hinge.panelB) === hinge.panelA) return hinge.panelB;
  if (hinge.panelA === baseId) return hinge.panelB;
  if (hinge.panelB === baseId) return hinge.panelA;
  return hinge.panelB;
}

/** Ao trocar a base: roles + panelId das operations alinhados à nova árvore. */
export function withBasePanel(
  config: BoxModelConfig,
  basePanelId: string,
): BoxModelConfig {
  const parentMap = buildParentMapFromBase(basePanelId, config.hinges ?? []);
  const hingeById = new Map((config.hinges ?? []).map((h) => [h.id, h]));
  const operations: BoxModelOperation[] = (config.operations ?? []).map((op) => {
    const h = hingeById.get(op.hingeId);
    if (!h) return op;
    return {
      ...op,
      panelId: movingPanelForHinge(h, parentMap, basePanelId),
    };
  });
  return {
    ...config,
    basePanelId,
    panels: (config.panels ?? []).map((p) => {
      const isBase = p.id === basePanelId;
      let role = p.role || "";
      let label = p.label || p.id;
      if (isBase) {
        role = "base";
        if (!label || label === p.id || label === "base") label = "base";
      } else if (role === "base") {
        role = "";
        if (label === "base") label = p.id;
      }
      return { ...p, role, label };
    }),
    operations,
  };
}
