import { useQuery } from "@tanstack/react-query";

import { fetchOsDetails } from "@/api/os";
import { queryKeys } from "@/api/query-keys";

export function useOsDetails(ano: number | null, id: number | null) {
  return useQuery({
    queryKey:
      ano != null && id != null
        ? queryKeys.os.details(ano, id)
        : ["os", "details", "idle"],
    queryFn: () => fetchOsDetails(ano!, id!),
    enabled: ano != null && id != null,
    staleTime: 30_000,
  });
}
