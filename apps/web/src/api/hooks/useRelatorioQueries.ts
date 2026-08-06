import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { searchOs } from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import {
  buildOsHomeSearchFilters,
  normalizeOsSearchFilters,
} from "@/features/os/osSearchUtils";
import type { RelatorioFilters } from "@/features/relatorio/types";
import { toOsSearchFiltersForPreview } from "@/features/relatorio/utils";

export function useReportPreviewCount(filters: RelatorioFilters) {
  const base = toOsSearchFiltersForPreview(filters);
  const osFilters = normalizeOsSearchFilters(
    buildOsHomeSearchFilters(base, {
      nrOs: base.nrOs,
      titulo: base.titulo ?? "",
    }),
  );
  return useQuery({
    queryKey: queryKeys.relatorio.previewCount(osFilters),
    queryFn: async ({ signal }) => {
      const data = await searchOs(osFilters, { signal });
      return data.meta?.total_records ?? data.data?.length ?? 0;
    },
    staleTime: 0,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}
