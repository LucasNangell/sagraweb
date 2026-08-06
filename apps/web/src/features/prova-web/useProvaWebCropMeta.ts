import { useQuery } from "@tanstack/react-query";

import { fetchProvaWebCropMeta } from "@/api/provaWeb";

export function useProvaWebCropMeta(
  ano: number,
  osId: number,
  relativePath: string | null,
  opts?: { detectMarks?: boolean; enabled?: boolean },
) {
  const detectMarks = Boolean(opts?.detectMarks);
  return useQuery({
    queryKey: ["prova-web-crop-meta", ano, osId, relativePath, detectMarks],
    queryFn: () =>
      fetchProvaWebCropMeta(ano, osId, relativePath!, {
        detectMarks,
      }),
    enabled: Boolean(relativePath) && (opts?.enabled ?? true),
    staleTime: 60_000,
    retry: 1,
  });
}
