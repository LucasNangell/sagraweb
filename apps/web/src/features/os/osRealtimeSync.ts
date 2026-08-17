import type { QueryClient } from "@tanstack/react-query";

import { fetchOsDetails, fetchOsHistory, fetchSubOsList, searchOs } from "@/api/os";
import { queryKeys } from "@/api/query-keys";

import {
  getActiveOsSearchFilters,
  refetchActiveOsSearchList,
} from "./osActiveSearchStore";
import { dedupeOsHistoryRows } from "./osHistoryUtils";
import { osSearchQueryKey } from "./osSearchQueryKey";
import { tryAcquireOsSearchRefreshLock } from "./osSearchRefreshLock";
import {
  dedupeOsSearchResponse,
  normalizeOsSearchFilters,
} from "./osSearchUtils";
import { toMainOsSelection } from "./osTableRows";
import type { OsSearchFilters, OsSearchResponse, OsSearchRow } from "./types";

export interface OsSystemUpdateMessage {
  type?: string;
  id?: number;
  ano?: number;
  action?: string;
  setor?: string;
  sub_os_id?: number;
  scope?: string;
}

async function fetchAndStoreOsSearch(
  queryClient: QueryClient,
  filters: OsSearchFilters,
): Promise<OsSearchResponse> {
  const normalized = normalizeOsSearchFilters(filters);
  const data = dedupeOsSearchResponse(await searchOs(normalized));
  queryClient.setQueryData(osSearchQueryKey(filters), data);
  return data;
}

/**
 * Recarrega a lista da home. Prioriza refetch() do useOsSearch montado;
 * fallback: GET /os/search + setQueryData quando a home não está montada.
 *
 * Single-flight + trailing: se vários eventos pedirem refresh enquanto um
 * GET /os/search ainda corre, só uma request fica em voo e no máximo mais uma
 * roda ao terminar (evita stampede no pool MySQL).
 */
let osSearchRefreshInFlight: Promise<void> | null = null;
let osSearchRefreshQueued = false;

/** Test helper: limpa single-flight entre casos de vitest. */
export function resetSilentOsSearchRefreshStateForTests(): void {
  osSearchRefreshInFlight = null;
  osSearchRefreshQueued = false;
}

async function runSilentRefreshOsSearchOnce(
  queryClient: QueryClient,
  filters: OsSearchFilters | undefined,
  options?: { skipCrossTabLock?: boolean },
): Promise<void> {
  if (
    !options?.skipCrossTabLock &&
    !tryAcquireOsSearchRefreshLock()
  ) {
    return;
  }

  if (await refetchActiveOsSearchList()) {
    return;
  }

  const resolved =
    filters ??
    getActiveOsSearchFilters() ??
    null;
  if (!resolved) {
    return;
  }

  await fetchAndStoreOsSearch(queryClient, resolved);
}

export async function silentRefreshOsSearch(
  queryClient: QueryClient,
  filters?: OsSearchFilters,
  options?: { skipCrossTabLock?: boolean },
): Promise<void> {
  osSearchRefreshQueued = true;
  if (!osSearchRefreshInFlight) {
    osSearchRefreshInFlight = (async () => {
      while (osSearchRefreshQueued) {
        osSearchRefreshQueued = false;
        await runSilentRefreshOsSearchOnce(queryClient, filters, options);
      }
    })().finally(() => {
      osSearchRefreshInFlight = null;
    });
  }
  await osSearchRefreshInFlight;
  if (osSearchRefreshQueued) {
    await silentRefreshOsSearch(queryClient, filters, options);
  }
}

/** Atualiza painéis de detalhes e histórico sem estado de loading inicial. */
export async function silentRefreshOsPanels(
  queryClient: QueryClient,
  ano: number,
  id: number,
): Promise<void> {
  const detailsKey = queryKeys.os.details(ano, id);
  const historyKey = queryKeys.os.history(ano, id);

  const [details, history] = await Promise.all([
    fetchOsDetails(ano, id),
    fetchOsHistory(ano, id),
  ]);
  queryClient.setQueryData(detailsKey, details);
  queryClient.setQueryData(historyKey, dedupeOsHistoryRows(history));
}

async function refreshSubOsQueries(
  queryClient: QueryClient,
  ano: number,
  id: number,
  subOsId: number | null | undefined,
): Promise<void> {
  if (subOsId != null) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.os.subOsHistory(ano, id, subOsId),
    });
  }
  await queryClient.invalidateQueries({
    queryKey: queryKeys.os.subOs(ano, id),
  });
}

/** Invalida lista e todos os históricos de Sub OS da OS (ex.: exclusão no histórico principal). */
export async function refreshAllSubOsQueries(
  queryClient: QueryClient,
  ano: number,
  id: number,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.os.subOs(ano, id),
  });
  await queryClient.invalidateQueries({
    queryKey: queryKeys.os.subOsSummary(ano, id),
  });
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === "os" &&
        key[1] === "subOsHistory" &&
        key[2] === ano &&
        key[3] === id
      );
    },
  });
}

export interface ApplyOsSystemUpdateOptions {
  selected: OsSearchRow | null;
  onSelectedRowPatched?: (row: OsSearchRow) => void;
}

/**
 * Atualização em tempo real: recarrega a lista com os filtros atuais e
 * atualiza painéis quando a OS afetada está selecionada.
 */
export async function applyOsSystemUpdate(
  queryClient: QueryClient,
  filters: OsSearchFilters,
  message: Pick<
    OsSystemUpdateMessage,
    "id" | "ano" | "action" | "sub_os_id"
  >,
  options: ApplyOsSystemUpdateOptions,
): Promise<void> {
  const { id, ano, action, sub_os_id: messageSubOsId } = message;

  const isSelected =
    id != null &&
    ano != null &&
    (options.selected?.is_sub_os
      ? options.selected.parent_nr_os === id &&
        options.selected.parent_ano === ano
      : options.selected?.nr_os === id && options.selected?.ano === ano);

  await silentRefreshOsSearch(queryClient, filters, { skipCrossTabLock: true });

  if (id == null || ano == null) {
    return;
  }

  if (action === "history_deleted") {
    await refreshAllSubOsQueries(queryClient, ano, id);
  }

  if (
    action === "sub_os_history_deleted" &&
    options.selected?.is_sub_os &&
    options.selected.sub_os_id != null
  ) {
    try {
      const subs = await fetchSubOsList(ano, id);
      const stillListed = subs.some((s) => s.id === options.selected!.sub_os_id);
      if (!stillListed) {
        options.onSelectedRowPatched?.(toMainOsSelection(options.selected));
      }
    } catch {
      /* ignore */
    }
  }

  const cached = queryClient.getQueryData<OsSearchResponse>(
    osSearchQueryKey(filters),
  );
  const freshRow =
    cached?.data.find((r) => r.nr_os === id && r.ano === ano) ?? null;

  const isSubOsEvent = action?.startsWith("sub_os_history_") === true;
  const targetSubOsId =
    messageSubOsId ?? options.selected?.sub_os_id ?? null;

  if (isSelected || isSubOsEvent) {
    if (freshRow && !options.selected?.is_sub_os) {
      options.onSelectedRowPatched?.(freshRow);
    }
    if (!options.selected?.is_sub_os || isSubOsEvent) {
      await silentRefreshOsPanels(queryClient, ano, id);
    }
    if (isSubOsEvent || options.selected?.is_sub_os) {
      await refreshSubOsQueries(queryClient, ano, id, targetSubOsId);
    }
  }
}
