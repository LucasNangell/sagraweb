import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";

import {
  addSubOsHistory,
  createOrGetSubOs,
  deleteSubOsHistory,
  fetchOsComponentes,
  fetchOsHistory,
  fetchSubOsHistory,
  fetchSubOsList,
  fetchSubOsSummary,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { dedupeOsHistoryRows } from "@/features/os/osHistoryUtils";
import { toMainOsSelection } from "@/features/os/osTableRows";
import type { SubOsHistoryPayload } from "@/features/os/types";
import { silentRefreshOsSearch } from "@/features/os/osRealtimeSync";
import { useOsSelectionStore } from "@/features/os/osSelectionStore";

export function useOsComponentes(
  ano: number | null,
  id: number | null,
  options?: { includeInactive?: boolean; enabled?: boolean },
) {
  const includeInactive = options?.includeInactive ?? false;
  const enabled =
    (options?.enabled ?? true) && ano != null && id != null;
  return useQuery({
    queryKey: [
      ...queryKeys.os.componentes(ano ?? 0, id ?? 0),
      includeInactive ? "all" : "active",
    ] as const,
    queryFn: () =>
      fetchOsComponentes(ano!, id!, { includeInactive }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSubOsList(ano: number | null, id: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.os.subOs(ano ?? 0, id ?? 0),
    queryFn: () => fetchSubOsList(ano!, id!),
    enabled: enabled && ano != null && id != null,
    staleTime: 15_000,
  });
}

export function useSubOsSummary(ano: number | null, id: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.os.subOsSummary(ano ?? 0, id ?? 0),
    queryFn: () => fetchSubOsSummary(ano!, id!),
    enabled: enabled && ano != null && id != null,
    staleTime: 30_000,
  });
}

export function useSubOsHistory(
  ano: number | null,
  id: number | null,
  subOsId: number | null,
) {
  return useQuery({
    queryKey: queryKeys.os.subOsHistory(ano ?? 0, id ?? 0, subOsId ?? 0),
    queryFn: () => fetchSubOsHistory(ano!, id!, subOsId!),
    enabled: ano != null && id != null && subOsId != null,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useSubOsHistoryMutations(
  ano: number | null,
  id: number | null,
  subOsId: number | null,
) {
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: (payload: SubOsHistoryPayload) => {
      if (ano == null || id == null || subOsId == null) {
        throw new Error("OS/Sub OS não selecionada");
      }
      return addSubOsHistory(ano, id, subOsId, payload);
    },
    onSuccess: async () => {
      if (ano == null || id == null || subOsId == null) {
        return;
      }
      const [subHistory, mainHistory] = await Promise.all([
        fetchSubOsHistory(ano, id, subOsId),
        fetchOsHistory(ano, id),
      ]);
      queryClient.setQueryData(
        queryKeys.os.subOsHistory(ano, id, subOsId),
        subHistory,
      );
      queryClient.setQueryData(
        queryKeys.os.history(ano, id),
        dedupeOsHistoryRows(mainHistory),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.os.subOs(ano, id) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.os.subOsSummary(ano, id),
      });
      await silentRefreshOsSearch(queryClient, undefined, {
        skipCrossTabLock: true,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (historyId: number) => {
      if (ano == null || id == null || subOsId == null) {
        throw new Error("OS/Sub OS não selecionada");
      }
      return deleteSubOsHistory(ano, id, subOsId, historyId);
    },
    onSuccess: async (result) => {
      if (ano == null || id == null || subOsId == null) {
        return;
      }
      const subHistory = await fetchSubOsHistory(ano, id, subOsId);
      queryClient.setQueryData(
        queryKeys.os.subOsHistory(ano, id, subOsId),
        subHistory,
      );
      if (!result.inherited) {
        const mainHistory = await fetchOsHistory(ano, id);
        queryClient.setQueryData(
          queryKeys.os.history(ano, id),
          dedupeOsHistoryRows(mainHistory),
        );
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.os.subOs(ano, id) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.os.subOsSummary(ano, id),
      });
      await silentRefreshOsSearch(queryClient, undefined, {
        skipCrossTabLock: true,
      });

      if (!result.still_listable) {
        const selected = useOsSelectionStore.getState().selected;
        if (selected?.is_sub_os && selected.sub_os_id === subOsId) {
          useOsSelectionStore.getState().setSelected(toMainOsSelection(selected));
        }
      }
    },
  });

  return { addMutation, deleteMutation };
}
