import { DASHBOARD_NEW_HIGHLIGHT_MS, DEFAULT_DASHBOARD_CONFIG } from "./constants";
import type {
  DashboardConfig,
  DashboardDisplayColumn,
  DashboardOsItem,
  DashboardPriorityType,
  PcpQueueItem,
} from "./types";

function resolvePriorityType(prioridade?: string | null): DashboardPriorityType {
  if (!prioridade) return null;
  if (prioridade.includes("Prometido")) return "priority-high";
  if (prioridade.includes("Solicitado")) return "priority-medium";
  return null;
}

function resolveDisplaySituacao(item: PcpQueueItem): string {
  const situacao = item.situacao ?? "";
  const obsText = String(item.observacao ?? "").toLowerCase();
  if (situacao === "Em Execução" && obsText.includes("analis")) {
    return "Analisar arquivo";
  }
  return situacao;
}

function matchesColumnStatus(situacao: string, statusFilter: string): boolean {
  return situacao === statusFilter || situacao.startsWith(statusFilter);
}

function getSortWeight(os: DashboardOsItem): number {
  const prio = os.prioridade || "";
  if (prio.includes("Prometido p/")) return 0;
  if (prio.includes("Solicitado p/")) return 1;
  const nr = parseInt(String(os.nr_os), 10);
  if (!Number.isNaN(nr) && nr < 5000) return 2;
  return 3;
}

function sortByPcp(a: DashboardOsItem, b: DashboardOsItem): number {
  const hasPcpA = Number.isInteger(a.pcp_ordem);
  const hasPcpB = Number.isInteger(b.pcp_ordem);
  if (hasPcpA || hasPcpB) {
    if (hasPcpA && hasPcpB) {
      return (a.pcp_ordem as number) - (b.pcp_ordem as number);
    }
    return hasPcpA ? -1 : 1;
  }
  const wA = getSortWeight(a);
  const wB = getSortWeight(b);
  if (wA !== wB) return wA - wB;
  const dA = a.last_update ? new Date(a.last_update).getTime() : 0;
  const dB = b.last_update ? new Date(b.last_update).getTime() : 0;
  return dB - dA;
}

export function formatOsNumber(nrOs: number | string, ano: number): string {
  const nr = parseInt(String(nrOs), 10);
  const prefix = !Number.isNaN(nr) && nr < 5000 ? "OS" : "SP";
  const yearSuffix = String(ano).slice(-2);
  return `${prefix} ${nrOs}/${yearSuffix}`;
}

export function formatQueueDisplayLabel(item: PcpQueueItem): string {
  if (item.row_kind === "sub_os") {
    return formatOsNumber(
      item.parent_nr_os ?? item.nr_os,
      item.parent_ano ?? item.ano,
    );
  }
  return formatOsNumber(item.nr_os, item.ano);
}

export function formatQueueDisplaySituacao(item: PcpQueueItem): string {
  const situacao = resolveDisplaySituacao(item);
  if (item.row_kind !== "sub_os") return situacao;
  const comp = item.componente_nome?.trim();
  if (!comp) return situacao;
  const prefix = `[${comp}]`;
  if (situacao.startsWith(prefix)) return situacao;
  return situacao ? `${prefix} ${situacao}` : prefix;
}

const FINISHED_SITUACOES = new Set(["Entregue", "Cancelada", "Cancelado"]);

export function osBelongsToDashboardSector(
  item: PcpQueueItem,
  sector: string,
): boolean {
  const situacao = (item.situacao ?? "").trim();
  if (FINISHED_SITUACOES.has(situacao)) return false;
  if (sector === "Gravação") {
    return situacao === "Gravação" || situacao === "Gravação Parcial";
  }
  return (item.setor ?? "").trim() === sector.trim();
}

export function dashboardItemKey(item: PcpQueueItem): string {
  if (item.row_kind === "sub_os" && item.sub_os_id != null) {
    return `${item.parent_nr_os ?? item.nr_os}-${item.parent_ano ?? item.ano}-sub-${item.sub_os_id}`;
  }
  return `${item.nr_os}-${item.ano}`;
}

export function mergeDashboardQueueSources(
  searchItems: PcpQueueItem[],
  pcpItems: PcpQueueItem[],
): PcpQueueItem[] {
  const pcpMainByKey = new Map<string, PcpQueueItem>();
  for (const item of pcpItems) {
    if (item.row_kind === "sub_os") continue;
    pcpMainByKey.set(dashboardItemKey(item), item);
  }

  const seen = new Set<string>();
  const merged: PcpQueueItem[] = [];

  for (const item of searchItems) {
    const key = dashboardItemKey(item);
    seen.add(key);
    const pcp = pcpMainByKey.get(key);
    merged.push(
      pcp
        ? {
            ...item,
            pcp_ordem: pcp.pcp_ordem ?? item.pcp_ordem ?? null,
            pcp_ultima_atualizacao:
              pcp.pcp_ultima_atualizacao ?? item.pcp_ultima_atualizacao ?? null,
          }
        : item,
    );
  }

  for (const item of pcpItems) {
    const key = dashboardItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function findColumnId(
  config: DashboardConfig,
  situacao: string,
): string | null {
  const colIndex = config.columns.findIndex((col) =>
    col.statuses.some((statusFilter) =>
      matchesColumnStatus(situacao, statusFilter),
    ),
  );
  return colIndex !== -1 ? config.columns[colIndex]!.id : null;
}

function markItemHighlighted(item: DashboardOsItem, now: number): void {
  item.isNew = true;
  item.highlightUntil = now + DASHBOARD_NEW_HIGHLIGHT_MS;
}

function patchDashboardOsItem(item: DashboardOsItem, os: PcpQueueItem): void {
  item.situacao = os.situacao;
  item.setor = os.setor;
  item.titulo = os.titulo;
  item.produto = os.produto;
  item.prioridade = os.prioridade;
  item.last_update = os.last_update;
  item.observacao = os.observacao;
  item.data_entrega = os.data_entrega;
  item.entreg_periodo = os.entreg_periodo;
  item.pcp_ordem = Number.isFinite(Number(os.pcp_ordem))
    ? Number(os.pcp_ordem)
    : null;
  item.pcp_ultima_atualizacao = os.pcp_ultima_atualizacao ?? null;
  item.priorityType = resolvePriorityType(os.prioridade);
  item.displaySituacao = formatQueueDisplaySituacao(os);
  item.row_kind = os.row_kind;
  item.sub_os_id = os.sub_os_id;
  item.componente_nome = os.componente_nome;
  item.parent_nr_os = os.parent_nr_os;
  item.parent_ano = os.parent_ano;
}

export function refreshDashboardHighlights(
  masterOpsMap: Map<string, DashboardOsItem>,
  now = Date.now(),
): boolean {
  let changed = false;
  for (const item of masterOpsMap.values()) {
    const shouldBeNew = (item.highlightUntil ?? 0) > now;
    if (item.isNew !== shouldBeNew) {
      item.isNew = shouldBeNew;
      changed = true;
    }
  }
  return changed;
}

export function processDashboardData(
  rawData: PcpQueueItem[],
  config: DashboardConfig,
  masterOpsMap: Map<string, DashboardOsItem>,
  options?: { now?: number; isInitialLoad?: boolean },
): {
  columns: DashboardDisplayColumn[];
  hasNewItems: boolean;
} {
  const now = options?.now ?? Date.now();
  const isInitialLoad = options?.isInitialLoad === true;
  const incomingIds = new Set<string>();
  let hasNewItems = false;

  const tempColumns: DashboardDisplayColumn[] = config.columns.map((col) => ({
    ...col,
    items: [],
  }));

  for (const os of rawData) {
    if (!osBelongsToDashboardSector(os, config.sector)) continue;
    const uniqueKey = dashboardItemKey(os);
    incomingIds.add(uniqueKey);
    const situacao = os.situacao ?? "";
    const currentColumnId = findColumnId(config, situacao);

    let item: DashboardOsItem;
    if (masterOpsMap.has(uniqueKey)) {
      item = masterOpsMap.get(uniqueKey)!;
      patchDashboardOsItem(item, os);
      item.isNew = (item.highlightUntil ?? 0) > now;
    } else {
      item = {
        ...os,
        uniqueKey,
        priorityType: resolvePriorityType(os.prioridade),
        isNew: false,
        pcp_ordem: Number.isFinite(Number(os.pcp_ordem))
          ? Number(os.pcp_ordem)
          : null,
        displaySituacao: formatQueueDisplaySituacao(os),
        lastColumnId: null,
        highlightUntil: 0,
      };
      if (!isInitialLoad) {
        markItemHighlighted(item, now);
        hasNewItems = true;
      }
      masterOpsMap.set(uniqueKey, item);
    }

    if (
      !isInitialLoad &&
      currentColumnId &&
      item.lastColumnId &&
      item.lastColumnId !== currentColumnId
    ) {
      markItemHighlighted(item, now);
      hasNewItems = true;
    }

    item.lastColumnId = currentColumnId;
    const colIndex = config.columns.findIndex((col) => col.id === currentColumnId);
    if (colIndex !== -1) {
      tempColumns[colIndex]!.items.push(item);
    }
  }

  for (const key of [...masterOpsMap.keys()]) {
    if (!incomingIds.has(key)) masterOpsMap.delete(key);
  }

  for (const col of tempColumns) {
    col.items.sort(sortByPcp);
  }

  return { columns: tempColumns, hasNewItems };
}

export function normalizeDashboardConfigFromRemote(
  remote: unknown,
  fallbackSector?: string | null,
): DashboardConfig {
  const parsed = (remote ?? {}) as Partial<DashboardConfig>;
  const columns =
    parsed.columns && parsed.columns.length > 0
      ? parsed.columns
      : DEFAULT_DASHBOARD_CONFIG.columns;
  return {
    sector:
      parsed.sector || fallbackSector || DEFAULT_DASHBOARD_CONFIG.sector,
    columnCount: columns.length,
    columns,
  };
}
