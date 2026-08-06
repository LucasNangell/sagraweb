import { useMutation, useQuery } from "@tanstack/react-query";

import { fetchOsPath } from "@/api/os";
import { queryKeys } from "@/api/query-keys";

export function useOsPathQuery(ano: number | null, id: number | null) {
  return useQuery({
    queryKey:
      ano != null && id != null
        ? queryKeys.os.path(ano, id)
        : ["os", "path", "idle"],
    queryFn: () => fetchOsPath(ano!, id!),
    enabled: ano != null && id != null,
    staleTime: 60_000,
  });
}

export function useOsPathMutation() {
  return useMutation({
    mutationFn: ({ ano, id }: { ano: number; id: number }) =>
      fetchOsPath(ano, id),
  });
}
