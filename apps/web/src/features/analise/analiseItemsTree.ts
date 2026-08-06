import type { AnaliseComponente, AnaliseSelectedItem, OsVersionItem } from "./types";
import { ANALISE_COMPONENTES } from "./types";
import type { VersionPdfFile } from "./versionPdfClassify";
import {
  classifyVersionPdfFiles,
  versionPdfFilesByComponente,
  versionRequiresCapaMioloSlots,
} from "./versionPdfClassify";

export interface AnaliseTreeComponentNode {
  key: string;
  label: string;
  items: AnaliseSelectedItem[];
  versionFile?: VersionPdfFile;
  versionFiles?: VersionPdfFile[];
}

export interface AnaliseTreeVersionNode {
  key: string;
  label: string;
  components: AnaliseTreeComponentNode[];
  itemCount: number;
}

/** Chave do subitem virtual «Pré-análise» na árvore de itens. */
export function preAnaliseTreeKey(versionKey: string): string {
  return `pre-analise::${versionKey}`;
}

export function isPreAnaliseTreeKey(key: string): boolean {
  return key.startsWith("pre-analise::");
}

/** Normaliza rótulo de componente para agrupamento no treeview. */
export function normalizeComponenteOrigem(componente: string | undefined): string {
  const value = (componente ?? "").trim();
  if (!value) return "Outros";
  if ((ANALISE_COMPONENTES as readonly string[]).includes(value)) return value;
  if (value.toLowerCase() === "encarte") return "Arq. Único";
  return value;
}

/** Verifica se o item pertence à versão (chave vN ou rótulo da pasta). */
export function itemMatchesVersion(
  itemVersao: string | undefined,
  version: OsVersionItem,
): boolean {
  const stored = (itemVersao ?? "").trim();
  if (!stored) return false;

  const versionKey = `v${version.version}`;
  if (stored === versionKey || stored === version.label) return true;

  const keyMatch = versionKey.match(/^v(\d+)$/i);
  const storedMatch = stored.match(/^v\s*(\d+)/i);
  if (keyMatch && storedMatch && keyMatch[1] === storedMatch[1]) return true;

  const storedLower = stored.toLowerCase();
  const labelLower = version.label.toLowerCase();
  return storedLower.includes(labelLower) || labelLower.includes(storedLower);
}

/** Versão da OS à qual o item está vinculado, ou null se não identificada. */
export function resolveItemVersion(
  itemVersao: string | undefined,
  versions: OsVersionItem[],
): OsVersionItem | null {
  const stored = (itemVersao ?? "").trim();
  if (!stored) return null;
  return versions.find((v) => itemMatchesVersion(stored, v)) ?? null;
}

/** Item registrado em versão anterior à versão atualmente selecionada no topo. */
export function isItemFromOlderVersion(
  itemVersao: string | undefined,
  currentVersaoKey: string,
  versions: OsVersionItem[],
): boolean {
  const current = versions.find((v) => `v${v.version}` === currentVersaoKey);
  if (!current) return false;
  if (itemMatchesVersion(itemVersao, current)) return false;
  const itemVersion = resolveItemVersion(itemVersao, versions);
  if (!itemVersion) return false;
  return itemVersion.version < current.version;
}

function sortComponents(a: string, b: string): number {
  const order = [...ANALISE_COMPONENTES, "Outros"];
  const ia = order.indexOf(a as AnaliseComponente);
  const ib = order.indexOf(b as AnaliseComponente);
  const ra = ia >= 0 ? ia : order.length;
  const rb = ib >= 0 ? ib : order.length;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "pt-BR");
}

type VersionComponentMode = "capa-miolo" | "arq-unico";

/** Define se a versão usa slots Capa+Miolo ou apenas Arq. Único (mutuamente exclusivos). */
export function resolveVersionComponentMode(
  classified: VersionPdfFile[],
  forceCapaMiolo: boolean,
  versionItems: AnaliseSelectedItem[],
): VersionComponentMode {
  if (forceCapaMiolo) return "capa-miolo";

  const pdfComponents = new Set(classified.map((entry) => entry.componente));
  const hasCapaMioloPdf = pdfComponents.has("Capa") || pdfComponents.has("Miolo");
  const hasArqUnicoPdf = pdfComponents.has("Arq. Único");

  if (hasCapaMioloPdf && !hasArqUnicoPdf) return "capa-miolo";
  if (hasArqUnicoPdf && !hasCapaMioloPdf) return "arq-unico";

  const itemComponents = new Set(
    versionItems.map((item) => normalizeComponenteOrigem(item.componenteOrigem)),
  );
  const hasCapaMioloItems = itemComponents.has("Capa") || itemComponents.has("Miolo");
  const hasArqUnicoItems = itemComponents.has("Arq. Único");

  if (hasCapaMioloItems && !hasArqUnicoItems) return "capa-miolo";
  if (hasArqUnicoItems && !hasCapaMioloItems) return "arq-unico";

  if (pdfComponents.has("Capa") && pdfComponents.has("Miolo")) return "capa-miolo";

  return "arq-unico";
}

function componentAllowedInMode(label: string, mode: VersionComponentMode): boolean {
  if (label === "Outros") return true;
  if (mode === "capa-miolo") return label === "Capa" || label === "Miolo";
  return label === "Arq. Único";
}

function buildComponentLabelsForVersion(
  classified: VersionPdfFile[],
  versionItems: AnaliseSelectedItem[],
  mode: VersionComponentMode,
): Set<string> {
  const labels = new Set<string>();

  if (mode === "capa-miolo") {
    labels.add("Capa");
    labels.add("Miolo");
  } else {
    labels.add("Arq. Único");
  }

  for (const item of versionItems) {
    labels.add(normalizeComponenteOrigem(item.componenteOrigem));
  }

  for (const entry of classified) {
    if (componentAllowedInMode(entry.componente, mode)) {
      labels.add(entry.componente);
    }
  }

  if (mode === "capa-miolo") {
    const hasArqUnicoItems = versionItems.some(
      (item) => normalizeComponenteOrigem(item.componenteOrigem) === "Arq. Único",
    );
    if (!hasArqUnicoItems) labels.delete("Arq. Único");
  } else {
    const hasCapaItems = versionItems.some(
      (item) => normalizeComponenteOrigem(item.componenteOrigem) === "Capa",
    );
    const hasMioloItems = versionItems.some(
      (item) => normalizeComponenteOrigem(item.componenteOrigem) === "Miolo",
    );
    if (!hasCapaItems) labels.delete("Capa");
    if (!hasMioloItems) labels.delete("Miolo");
  }

  return labels;
}

/** Monta árvore Versão → Componente → Itens. */
export function buildAnaliseItemsTree(
  versions: OsVersionItem[],
  items: AnaliseSelectedItem[],
  versionPdfPerFile?: Record<string, { name: string; path: string; pages: number }[]>,
  produto?: string | null,
  capaMioloChoiceByVersion?: Record<string, boolean>,
): AnaliseTreeVersionNode[] {
  return versions.map((version) => {
    const versionItems = items.filter((item) => itemMatchesVersion(item.versaoOrigem, version));
    const versionKey = `v${version.version}`;
    const classified = classifyVersionPdfFiles(versionPdfPerFile?.[versionKey] ?? [], {
      versionLabel: version.label,
      produto,
      tratarComoCapaMiolo: capaMioloChoiceByVersion?.[versionKey],
    });
    const pdfByComponent = versionPdfFilesByComponente(classified);
    const forceCapaMiolo = versionRequiresCapaMioloSlots(produto, version.label);
    const componentMode = resolveVersionComponentMode(classified, forceCapaMiolo, versionItems);
    const componentLabels = buildComponentLabelsForVersion(
      classified,
      versionItems,
      componentMode,
    );

    const components = [...componentLabels].sort(sortComponents).map((label) => ({
      key: `${version.version}-${label}`,
      label,
      items: versionItems.filter(
        (item) => normalizeComponenteOrigem(item.componenteOrigem) === label,
      ),
      versionFiles: pdfByComponent[label as AnaliseComponente],
      versionFile: pdfByComponent[label as AnaliseComponente]?.[0],
    }));

    return {
      key: `v${version.version}`,
      label: version.label,
      components,
      itemCount: versionItems.length,
    };
  });
}

export function analiseItemDragId(itemId: number): string {
  return `item:${itemId}`;
}

export function analiseComponentDropId(versionKey: string, componentLabel: string): string {
  return `comp:${versionKey}::${componentLabel}`;
}

/** Chaves de todos os nós (versão e componente) para iniciar colapsados. */
export function allAnaliseTreeNodeKeys(versions: OsVersionItem[]): Set<string> {
  const keys = new Set<string>();
  for (const version of versions) {
    keys.add(`v${version.version}`);
    for (const comp of ANALISE_COMPONENTES) {
      keys.add(`${version.version}-${comp}`);
    }
  }
  return keys;
}
