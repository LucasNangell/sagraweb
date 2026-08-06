import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addOsHistory,
  deleteOsHistory,
  fetchOsHistory,
  replicateOsHistory,
  updateOsHistory,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import type { HistoryPayload } from "@/features/os/types";
import { dedupeOsHistoryRows } from "@/features/os/osHistoryUtils";
import {
  refreshAllSubOsQueries,
  silentRefreshOsSearch,
} from "@/features/os/osRealtimeSync";

export function useOsHistory(ano: number | null, id: number | null) {
  const osAno = ano != null ? Number(ano) : null;
  const osId = id != null ? Number(id) : null;

  return useQuery({
    queryKey:
      osAno != null && osId != null
        ? queryKeys.os.history(osAno, osId)
        : ["os", "history", "disabled"],
    queryFn: async () => {
      const rows = await fetchOsHistory(osAno!, osId!);
      return dedupeOsHistoryRows(rows);
    },
    enabled: osAno != null && osId != null,
    staleTime: 15_000,
    structuralSharing: false,
    refetchOnMount: "always",
  });
}

export function useOsHistoryMutations(ano: number | null, id: number | null) {
  const queryClient = useQueryClient();
  const osAno = ano != null ? Number(ano) : null;
  const osId = id != null ? Number(id) : null;

  const refreshHistoryCache = async () => {
    if (osAno == null || osId == null) {
      return;
    }
    const rows = await fetchOsHistory(osAno, osId);
    queryClient.setQueryData(
      queryKeys.os.history(osAno, osId),
      dedupeOsHistoryRows(rows),
    );
  };

  const refreshSearchList = async () => {
    await silentRefreshOsSearch(queryClient, undefined, {
      skipCrossTabLock: true,
    });
  };

  const invalidate = async () => {
    if (osAno == null || osId == null) {
      return;
    }
    await refreshHistoryCache();
    await refreshAllSubOsQueries(queryClient, osAno, osId);
    await refreshSearchList();
  };

  const addMutation = useMutation({
    mutationFn: (payload: HistoryPayload) =>
      addOsHistory(osAno!, osId!, payload),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: HistoryPayload & { cod_status: string }) =>
      updateOsHistory(osAno!, osId!, payload),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (codStatus: string) =>
      deleteOsHistory(osAno!, osId!, codStatus),
    onSuccess: invalidate,
  });

  const replicateMutation = useMutation({
    mutationFn: (payload: HistoryPayload) =>
      replicateOsHistory(osAno!, osId!, payload),
    onSuccess: invalidate,
  });

  return { addMutation, updateMutation, deleteMutation, replicateMutation };
}
