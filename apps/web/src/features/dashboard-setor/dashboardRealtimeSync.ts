import type { PcpQueueItem } from "@/api/pcp";

import {
  fetchDashboardOsByKey,
  fetchPcpQueueForDashboard,
} from "./api";
import {
  dashboardItemKey,
  hashDashboardItems,
  mergePcpOrderIntoItems,
  osBelongsToAnyDashboardSector,
  removeOsKeysFromMap,
} from "./utils";
import type { DashboardWsMessage } from "./types";

const FINISHED_SITUACOES = new Set(["Entregue", "Cancelada", "Cancelado"]);

/** SP / papelaria (Corel) — cards do painel vêm das linhas Sub OS na fila PCP. */
export const PAPELARIA_OS_MIN = 5000;

export function osUpdateKey(nrOs: number, ano: number): string {
  return `${nrOs}-${ano}`;
}

export function isPapelariaDashboardOs(nrOs: number): boolean {
  return Number.isFinite(nrOs) && nrOs >= PAPELARIA_OS_MIN;
}

export function shouldFetchSubOsForEvent(message: DashboardWsMessage): boolean {
  if (message.sub_os_id != null) {
    return true;
  }
  const action = message.action ?? "";
  if (action.startsWith("sub_os_")) {
    return true;
  }
  const nrOs = Number(message.id);
  return isPapelariaDashboardOs(nrOs);
}

export function isFinishedSituacao(situacao?: string | null): boolean {
  return FINISHED_SITUACOES.has((situacao ?? "").trim());
}

function normalizeSectors(sectors: string | string[]): string[] {
  const raw = Array.isArray(sectors) ? sectors : [sectors];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const sector = value.trim();
    if (!sector || seen.has(sector)) {
      continue;
    }
    seen.add(sector);
    out.push(sector);
  }
  return out;
}

function itemBelongsToSectors(
  item: PcpQueueItem,
  sectors: string[],
): boolean {
  return osBelongsToAnyDashboardSector(item, sectors);
}

/**
 * Busca estado atual de uma OS (e Sub OS relacionadas, se necessário) para patch incremental.
 */
export async function fetchDashboardItemsForOsEvent(
  sectors: string | string[],
  nrOs: number,
  ano: number,
  options?: { includeSubOs?: boolean; subOsId?: number | null },
): Promise<PcpQueueItem[]> {
  const sectorList = normalizeSectors(sectors);
  const includeSubOs = options?.includeSubOs === true;
  const main = await fetchDashboardOsByKey(nrOs, ano);

  if (!includeSubOs) {
    if (!main || !itemBelongsToSectors(main, sectorList)) {
      return [];
    }
    return [main];
  }

  const pcpLists = await Promise.all(
    sectorList.map((sector) => fetchPcpQueueForDashboard(sector)),
  );
  const related = pcpLists.flat().filter((item) => {
    if (item.row_kind === "sub_os") {
      const parentNr = item.parent_nr_os ?? item.nr_os;
      const parentAno = item.parent_ano ?? item.ano;
      if (parentNr !== nrOs || parentAno !== ano) {
        return false;
      }
      if (options?.subOsId != null) {
        return item.sub_os_id === options.subOsId;
      }
      return true;
    }
    return item.nr_os === nrOs && item.ano === ano;
  });

  const result: PcpQueueItem[] = [];
  const mainFromPcp = related.find((item) => item.row_kind !== "sub_os");

  if (main && itemBelongsToSectors(main, sectorList)) {
    result.push({
      ...main,
      pcp_ordem: mainFromPcp?.pcp_ordem ?? main.pcp_ordem ?? null,
      pcp_ultima_atualizacao:
        mainFromPcp?.pcp_ultima_atualizacao ?? main.pcp_ultima_atualizacao ?? null,
    });
  } else if (
    mainFromPcp &&
    itemBelongsToSectors(mainFromPcp, sectorList)
  ) {
    result.push(mainFromPcp);
  }

  const seenSubKeys = new Set<string>();
  for (const sub of related.filter((item) => item.row_kind === "sub_os")) {
    if (!itemBelongsToSectors(sub, sectorList)) {
      continue;
    }
    const key = dashboardItemKey(sub);
    if (seenSubKeys.has(key)) {
      continue;
    }
    seenSubKeys.add(key);
    result.push(sub);
  }

  return result;
}

/**
 * Aplica patch incremental no mapa de itens do painel (sem refetch da lista inteira).
 */
export function applyOsPatchToItemsMap(
  itemsMap: Map<string, PcpQueueItem>,
  sectors: string | string[],
  nrOs: number,
  ano: number,
  incoming: PcpQueueItem[],
  options?: { subOsId?: number | null },
): { map: Map<string, PcpQueueItem>; changed: boolean } {
  const sectorList = normalizeSectors(sectors);
  const beforeSig = hashDashboardItems(itemsMap.values());
  const next = new Map(itemsMap);

  if (options?.subOsId != null) {
    next.delete(`${nrOs}-${ano}-sub-${options.subOsId}`);
  } else {
    removeOsKeysFromMap(next, nrOs, ano);
  }

  for (const item of incoming) {
    if (!itemBelongsToSectors(item, sectorList)) {
      continue;
    }
    const key = dashboardItemKey(item);
    const previous = itemsMap.get(key);
    next.set(key, {
      ...item,
      pcp_ordem: item.pcp_ordem ?? previous?.pcp_ordem ?? null,
      pcp_ultima_atualizacao:
        item.pcp_ultima_atualizacao ?? previous?.pcp_ultima_atualizacao ?? null,
    });
  }

  const afterSig = hashDashboardItems(next.values());
  return { map: next, changed: beforeSig !== afterSig };
}

export async function mergePcpOrderFromQueue(
  itemsMap: Map<string, PcpQueueItem>,
  sectors: string | string[],
): Promise<{ map: Map<string, PcpQueueItem>; changed: boolean }> {
  const sectorList = normalizeSectors(sectors);
  const pcpLists = await Promise.all(
    sectorList.map((sector) => fetchPcpQueueForDashboard(sector)),
  );
  const seen = new Set<string>();
  const pcpItems: PcpQueueItem[] = [];
  for (const list of pcpLists) {
    for (const item of list) {
      const key = dashboardItemKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pcpItems.push(item);
    }
  }

  const { items, changed } = mergePcpOrderIntoItems(
    [...itemsMap.values()],
    pcpItems,
  );
  if (!changed) {
    return { map: itemsMap, changed: false };
  }
  return {
    map: new Map(items.map((item) => [dashboardItemKey(item), item])),
    changed: true,
  };
}

export function parseOsUpdateKey(key: string): { nrOs: number; ano: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  return { nrOs: Number(match[1]), ano: Number(match[2]) };
}
