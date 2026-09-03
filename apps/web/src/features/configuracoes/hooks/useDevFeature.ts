import { useQuery } from "@tanstack/react-query";

import { fetchDevFeatures } from "@/api/devFeatures";
import { queryKeys } from "@/api/query-keys";

/** Retorna se a flag está habilitada. Em loading/erro trata como desligada. */
export function useDevFeature(featureId: string): boolean {
  const query = useQuery({
    queryKey: queryKeys.devFeatures.all,
    queryFn: fetchDevFeatures,
    staleTime: 60_000,
  });

  if (!query.data) return false;
  return Boolean(query.data.enabled?.[featureId]);
}
