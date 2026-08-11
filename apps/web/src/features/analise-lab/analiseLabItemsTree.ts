import type { AnaliseLabItem } from "@/api/analiseLab";
import {
  buildComponentLabelsForVersion,
  itemMatchesVersion,
  normalizeComponenteOrigem,
  resolveItemVersion,
  resolveVersionComponentMode,
} from "@/features/analise/analiseItemsTree";
import type { AnaliseComponente, OsVersionItem } from "@/features/analise/types";
import type { VersionPdfFile } from "@/features/analise/versionPdfClassify";
import {
  classifyVersionPdfFiles,
  versionPdfFilesByComponente,
  versionRequiresCapaMioloSlots,
} from "@/features/analise/versionPdfClassify";

export interface LabTreeComponentNode {
  key: string;
  label: string;
  items: AnaliseLabItem[];
  versionFile?: VersionPdfFile;
  versionFiles?: VersionPdfFile[];
}

export interface LabTreeVersionNode {
  key: string;
  label: string;
  readonly: boolean;
  components: LabTreeComponentNode[];
  itemCount: number;
}

export type LabVersionPdfPerFile = Record<
  string,
  { name: string; path: string; pages: number }[]
>;

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
  versions: OsVersionItem[] = [],
): boolean {
  const current = (currentVersaoLabel || "").trim();
  const versao = (versaoLabel || "").trim();
  if (!current || !versao || versao === "(sem versão)") return false;
  if (versao === current) return false;

  if (versions.length > 0) {
    const currentVersion = resolveItemVersion(current, versions);
    const itemVersion = resolveItemVersion(versao, versions);
    if (currentVersion && itemVersion) {
      return currentVersion.version !== itemVersion.version;
    }
    if (currentVersion && itemMatchesVersion(versao, currentVersion)) {
      return false;
    }
  }

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

function sortLabItems(list: AnaliseLabItem[]): AnaliseLabItem[] {
  return list
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.id - b.id);
}

function toTreeItemShape(item: AnaliseLabItem): { componenteOrigem?: string } {
  return { componenteOrigem: item.componente };
}

function buildOsVersionNode(
  version: OsVersionItem,
  versionItems: AnaliseLabItem[],
  currentVersaoLabel: string,
  versions: OsVersionItem[],
  versionPdfPerFile?: LabVersionPdfPerFile,
  produto?: string | null,
  capaMioloChoiceByVersion?: Record<string, boolean>,
): LabTreeVersionNode {
  const versionKey = `v${version.version}`;
  const classified = classifyVersionPdfFiles(versionPdfPerFile?.[versionKey] ?? [], {
    versionLabel: version.label,
    produto,
    tratarComoCapaMiolo: capaMioloChoiceByVersion?.[versionKey],
  });
  const pdfByComponent = versionPdfFilesByComponente(classified);
  const forceCapaMiolo = versionRequiresCapaMioloSlots(produto, version.label);
  const shaped = versionItems.map(toTreeItemShape);
  const componentMode = resolveVersionComponentMode(classified, forceCapaMiolo, shaped);
  const componentLabels = buildComponentLabelsForVersion(
    classified,
    shaped,
    componentMode,
  );

  const components = [...componentLabels].sort(sortComponents).map((label) => ({
    key: `${version.label}::${label}`,
    label,
    items: sortLabItems(
      versionItems.filter(
        (item) => normalizeComponenteOrigem(item.componente) === label,
      ),
    ),
    versionFiles: pdfByComponent[label as AnaliseComponente],
    versionFile: pdfByComponent[label as AnaliseComponente]?.[0],
  }));

  return {
    key: versionKey,
    label: version.label,
    readonly: isLabVersionReadOnly(version.label, currentVersaoLabel, versions),
    components,
    itemCount: versionItems.length,
  };
}

function buildOrphanVersionNode(
  versaoLabel: string,
  versionItems: AnaliseLabItem[],
  currentVersaoLabel: string,
  versions: OsVersionItem[],
): LabTreeVersionNode {
  const byComp = new Map<string, AnaliseLabItem[]>();
  for (const item of versionItems) {
    const c = normalizeComponenteOrigem(item.componente);
    if (!byComp.has(c)) byComp.set(c, []);
    byComp.get(c)!.push(item);
  }

  const components = [...byComp.entries()]
    .sort(([a], [b]) => sortComponents(a, b))
    .map(([comp, list]) => ({
      key: `${versaoLabel}::${comp}`,
      label: comp,
      items: sortLabItems(list),
    }));

  return {
    key: versaoLabel,
    label: versaoLabel,
    readonly: isLabVersionReadOnly(versaoLabel, currentVersaoLabel, versions),
    components,
    itemCount: versionItems.length,
  };
}

export function buildLabItemsTree(
  items: AnaliseLabItem[],
  currentVersaoLabel = "",
  versions: OsVersionItem[] = [],
  versionPdfPerFile?: LabVersionPdfPerFile,
  produto?: string | null,
  capaMioloChoiceByVersion?: Record<string, boolean>,
): LabTreeVersionNode[] {
  if (versions.length === 0) {
    const byVersao = new Map<string, AnaliseLabItem[]>();
    for (const item of items) {
      const v = item.versaoLabel || "(sem versão)";
      if (!byVersao.has(v)) byVersao.set(v, []);
      byVersao.get(v)!.push(item);
    }
    return [...byVersao.entries()]
      .map(([versao, list]) =>
        buildOrphanVersionNode(versao, list, currentVersaoLabel, versions),
      )
      .sort((a, b) => {
        if (a.readonly !== b.readonly) return a.readonly ? 1 : -1;
        return a.label.localeCompare(b.label, "pt-BR");
      });
  }

  const matchedIds = new Set<number>();
  const versionNodes = versions.map((version) => {
    const versionItems = items.filter((item) =>
      itemMatchesVersion(item.versaoLabel, version),
    );
    for (const item of versionItems) matchedIds.add(item.id);
    return buildOsVersionNode(
      version,
      versionItems,
      currentVersaoLabel,
      versions,
      versionPdfPerFile,
      produto,
      capaMioloChoiceByVersion,
    );
  });

  const orphansByLabel = new Map<string, AnaliseLabItem[]>();
  for (const item of items) {
    if (matchedIds.has(item.id)) continue;
    const label = item.versaoLabel || "(sem versão)";
    if (!orphansByLabel.has(label)) orphansByLabel.set(label, []);
    orphansByLabel.get(label)!.push(item);
  }

  const orphanNodes = [...orphansByLabel.entries()].map(([label, list]) =>
    buildOrphanVersionNode(label, list, currentVersaoLabel, versions),
  );

  return [...versionNodes, ...orphanNodes].sort((a, b) => {
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
