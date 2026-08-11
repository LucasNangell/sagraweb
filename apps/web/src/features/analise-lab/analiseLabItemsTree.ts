import type { AnaliseLabItem } from "@/api/analiseLab";

export interface LabTreeComponentNode {
  key: string;
  label: string;
  items: AnaliseLabItem[];
}

export interface LabTreeVersionNode {
  key: string;
  label: string;
  readonly: boolean;
  components: LabTreeComponentNode[];
  itemCount: number;
}

const COMPONENT_ORDER = ["Capa", "Miolo", "Arq. Único", "Outros"];

export function labItemDragId(itemId: number): string {
  return `lab-item:${itemId}`;
}

export function labComponentDropId(versaoLabel: string, componente: string): string {
  return `lab-comp:${versaoLabel}::${componente}`;
}

export function parseLabItemDragId(id: string): number | null {
  const m = /^lab-item:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export function parseLabComponentDropId(
  id: string,
): { versaoLabel: string; componente: string } | null {
  const m = /^lab-comp:(.+)::(.+)$/.exec(id);
  if (!m) return null;
  return { versaoLabel: m[1], componente: m[2] };
}

export function isLabVersionReadOnly(
  versaoLabel: string,
  currentVersaoLabel: string,
): boolean {
  const current = (currentVersaoLabel || "").trim();
  const versao = (versaoLabel || "").trim();
  if (!current || !versao || versao === "(sem versão)") return false;
  return versao !== current;
}

function sortComponents(a: string, b: string): number {
  const ia = COMPONENT_ORDER.indexOf(a);
  const ib = COMPONENT_ORDER.indexOf(b);
  const ra = ia >= 0 ? ia : COMPONENT_ORDER.length;
  const rb = ib >= 0 ? ib : COMPONENT_ORDER.length;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "pt-BR");
}

export function buildLabItemsTree(
  items: AnaliseLabItem[],
  currentVersaoLabel = "",
): LabTreeVersionNode[] {
  const byVersao = new Map<string, Map<string, AnaliseLabItem[]>>();
  for (const item of items) {
    const v = item.versaoLabel || "(sem versão)";
    const c = item.componente || "Outros";
    if (!byVersao.has(v)) byVersao.set(v, new Map());
    const byComp = byVersao.get(v)!;
    if (!byComp.has(c)) byComp.set(c, []);
    byComp.get(c)!.push(item);
  }

  return [...byVersao.entries()]
    .map(([versao, byComp]) => {
      const components = [...byComp.entries()]
        .sort(([a], [b]) => sortComponents(a, b))
        .map(([comp, list]) => ({
          key: `${versao}::${comp}`,
          label: comp,
          items: list
            .slice()
            .sort(
              (a, b) =>
                (a.ordem || 0) - (b.ordem || 0) || a.id - b.id,
            ),
        }));
      return {
        key: versao,
        label: versao,
        readonly: isLabVersionReadOnly(versao, currentVersaoLabel),
        components,
        itemCount: components.reduce((sum, c) => sum + c.items.length, 0),
      };
    })
    .sort((a, b) => {
      if (a.readonly !== b.readonly) return a.readonly ? 1 : -1;
      return a.label.localeCompare(b.label, "pt-BR");
    });
}

export function canDropLabItem(args: {
  sourceVersao: string;
  sourceComponente: string;
  targetVersao: string;
  targetComponente: string;
  readonlySource?: boolean;
  readonlyTarget?: boolean;
}): boolean {
  if (args.readonlySource || args.readonlyTarget) return false;
  if (args.sourceVersao !== args.targetVersao) return false;
  return true;
}

/** Reordena ids dentro do componente alvo ao soltar um item. */
export function reorderIdsAfterDrop(args: {
  componentItemIds: number[];
  draggedId: number;
  overItemId: number | null;
  targetIsComponent: boolean;
}): number[] {
  const { componentItemIds, draggedId, overItemId, targetIsComponent } = args;
  const without = componentItemIds.filter((id) => id !== draggedId);
  if (targetIsComponent || overItemId == null) {
    return [...without, draggedId];
  }
  const idx = without.indexOf(overItemId);
  if (idx < 0) return [...without, draggedId];
  const next = without.slice();
  next.splice(idx, 0, draggedId);
  return next;
}
