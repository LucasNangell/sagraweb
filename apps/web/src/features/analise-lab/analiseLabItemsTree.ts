import type { AnaliseLabFonte, AnaliseLabItem } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";
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

import { itemHomesForComponents } from "./analiseLabComponente";

export function fontesToVersionFiles(
  fontes: AnaliseLabFonte[] | null | undefined,
  pdfIndex: { name: string; path: string; pages: number }[] = [],
): VersionPdfFile[] {
  if (!fontes?.length) return [];
  const byPath = new Map(
    pdfIndex.map((file) => [file.path.replace(/\\/g, "/"), file]),
  );
  return fontes
    .slice()
    .sort(
      (a, b) =>
        a.ordem - b.ordem || a.path.localeCompare(b.path, "pt-BR"),
    )
    .map((fonte) => {
      const hit = byPath.get(fonte.path.replace(/\\/g, "/"));
      return {
        name: hit?.name || fonte.path.split("/").pop() || fonte.path,
        path: fonte.path,
        pages: hit?.pages ?? 0,
        componente: fonte.componente as AnaliseComponente,
      };
    });
}

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

export function labItemDragId(itemId: number, componente = ""): string {
  const comp = (componente || "").trim();
  return comp ? `lab-item:${itemId}::${comp}` : `lab-item:${itemId}`;
}

export function labComponentDropId(versaoLabel: string, componente: string): string {
  return `lab-comp:${versaoLabel}::${componente}`;
}

export function parseLabItemDragId(id: string): number | null {
  const m = /^lab-item:(\d+)/.exec(id);
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

/** Itens da versão carregada na sessão Lab (Folhear). Sem rótulo fica de fora. */
export function itemsForCurrentLabVersion(
  items: AnaliseLabItem[],
  currentVersaoLabel: string,
  versions: OsVersionItem[] = [],
): AnaliseLabItem[] {
  const current = (currentVersaoLabel || "").trim();
  if (!current) return [];
  const currentVersion =
    versions.length > 0 ? resolveItemVersion(current, versions) : null;
  return items.filter((item) => {
    const stored = (item.versaoLabel || "").trim();
    if (!stored) return false;
    if (currentVersion) return itemMatchesVersion(stored, currentVersion);
    if (stored === current) return true;
    const storedLower = stored.toLowerCase();
    const currentLower = current.toLowerCase();
    return (
      storedLower.includes(currentLower) || currentLower.includes(storedLower)
    );
  });
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

function groupItemsByHomes(
  versionItems: AnaliseLabItem[],
  pages: ProvaWebPageMeta[],
  modo: string,
): Map<string, AnaliseLabItem[]> {
  const byComp = new Map<string, AnaliseLabItem[]>();
  for (const item of versionItems) {
    const homes = itemHomesForComponents(item, pages, modo);
    for (const home of homes) {
      const label = normalizeComponenteOrigem(home);
      if (!byComp.has(label)) byComp.set(label, []);
      byComp.get(label)!.push(item);
    }
  }
  return byComp;
}

function buildOsVersionNode(
  version: OsVersionItem,
  versionItems: AnaliseLabItem[],
  currentVersaoLabel: string,
  versions: OsVersionItem[],
  versionPdfPerFile?: LabVersionPdfPerFile,
  produto?: string | null,
  capaMioloChoiceByVersion?: Record<string, boolean>,
  pages: ProvaWebPageMeta[] = [],
  modo = "capa_miolo",
  sessionFontes?: AnaliseLabFonte[] | null,
): LabTreeVersionNode {
  const versionKey = `v${version.version}`;
  const folderFiles = versionPdfPerFile?.[versionKey] ?? [];
  const useSession =
    Boolean(sessionFontes?.length) &&
    itemMatchesVersion(currentVersaoLabel, version);
  const classified = useSession
    ? fontesToVersionFiles(sessionFontes, folderFiles)
    : classifyVersionPdfFiles(folderFiles, {
        versionLabel: version.label,
        produto,
        tratarComoCapaMiolo: capaMioloChoiceByVersion?.[versionKey],
      });
  const pdfByComponent = versionPdfFilesByComponente(classified);
  const forceCapaMiolo = versionRequiresCapaMioloSlots(produto, version.label);
  const itemsByHome = groupItemsByHomes(versionItems, pages, modo);
  const shaped = [
    ...versionItems.map(toTreeItemShape),
    ...[...itemsByHome.keys()].map((label) => ({ componenteOrigem: label })),
  ];
  const componentMode = resolveVersionComponentMode(classified, forceCapaMiolo, shaped);
  const componentLabels = buildComponentLabelsForVersion(
    classified,
    shaped,
    componentMode,
  );
  for (const label of itemsByHome.keys()) {
    componentLabels.add(label);
  }

  const components = [...componentLabels].sort(sortComponents).map((label) => ({
    key: `${version.label}::${label}`,
    label,
    items: sortLabItems(itemsByHome.get(label) ?? []),
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
  pages: ProvaWebPageMeta[] = [],
  modo = "capa_miolo",
): LabTreeVersionNode {
  const byComp = groupItemsByHomes(versionItems, pages, modo);

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
  pages: ProvaWebPageMeta[] = [],
  modo = "capa_miolo",
  sessionFontes?: AnaliseLabFonte[] | null,
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
        buildOrphanVersionNode(
          versao,
          list,
          currentVersaoLabel,
          versions,
          pages,
          modo,
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
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
      pages,
      modo,
      sessionFontes,
    );
  });

  const orphansByLabel = new Map<string, AnaliseLabItem[]>();
  for (const item of items) {
    if (matchedIds.has(item.id)) continue;
    const label = item.versaoLabel || "(sem versão)";
    if (!orphansByLabel.has(label)) orphansByLabel.set(label, []);
    orphansByLabel.get(label)!.push(item);
  }

  const orphanNodes = [...orphansByLabel.entries()]
    .map(([label, list]) =>
      buildOrphanVersionNode(
        label,
        list,
        currentVersaoLabel,
        versions,
        pages,
        modo,
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  // Preserva ordem das pastas Original da OS (como Análise); órfãos no fim.
  return [...versionNodes, ...orphanNodes];
}

/** Chaves de versão e componente usadas no colapso da lista Lab. */
export function allLabTreeNodeKeys(tree: LabTreeVersionNode[]): Set<string> {
  const keys = new Set<string>();
  for (const version of tree) {
    keys.add(version.key);
    for (const comp of version.components) {
      keys.add(labComponentCollapseKey(version.key, comp.key));
    }
  }
  return keys;
}

export function labComponentCollapseKey(
  versionKey: string,
  componentKey: string,
): string {
  return `${versionKey}::${componentKey}`;
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
